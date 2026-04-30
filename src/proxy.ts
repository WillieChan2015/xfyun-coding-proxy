import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { config } from './config';
import { extractTokenUsage, fmtTokens } from './util';
import { sessionStats } from './stats';

// HTTP 状态码级别的重试条件：429 限流、503 服务过载
export const RETRYABLE_STATUS_CODES = new Set([429, 503]);

// 讯飞业务层错误码：
//   10012 引擎内部繁忙
//   10010 引擎忙 / RecvFromEngineError / WebSocket 异常断开
//   11210 NotEnoughCvError 额度/配额不足（FPM 速率限制，等待后可重试）
export const RETRYABLE_XFYUN_CODES = new Set([10012, 10010, 11210]);

/**
 * 检测响应体是否包含讯飞可重试错误码
 * 讯飞的错误格式为 {"code": 10012, "msg": "..."}，可能出现在 HTTP 200 的响应中
 */
export function isRetryableXfyunError(responseBody: string): boolean {
  for (const code of RETRYABLE_XFYUN_CODES) {
    if (responseBody.includes(`"code":${code}`) || responseBody.includes(`"code": ${code}`)) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 路径重写：客户端请求 /v1/* → 上游 /v2/*
 * 讯飞 Coding Plan 的 OpenAI 协议端点使用 /v2 前缀
 */
export function rewritePath(originalPath: string): string {
  return originalPath.replace(/^\/v1/, '');
}

/**
 * 构建上游请求 URL
 * 1. 去掉 baseUrl 末尾斜杠
 * 2. 将客户端路径 /v1/xxx 重写为 /xxx
 * 3. 拼接为 https://maas-coding-api.../v2/xxx
 */
export function buildUpstreamUrl(path: string): string {
  const base = config.baseUrl.replace(/\/$/, '');
  const cleanPath = rewritePath(path);
  return `${base}${cleanPath}`;
}

// 讯飞 SSE 事件类型白名单：仅转发标准 OpenAI 兼容事件
// 讯飞会发送 progress_notice（处理进度心跳）和 context_usage（token用量更新）等
// 非标准事件，Trae IDE 的 SSE 解析器不认识这些事件类型，遇到时会终止流并报 4054
// 参考：https://github.com/Trae-AI/Trae/issues/2466
export const BLOCKED_SSE_EVENTS = new Set(['progress_notice', 'context_usage']);

/**
 * 解析并过滤 SSE 事件流
 *
 * SSE 规范格式：
 *   event: <type>\n      ← 可选，默认为 "message"
 *   data: <payload>\n    ← 可多行
 *   \n                   ← 空行表示事件结束
 *
 * 过滤逻辑：遇到 event: progress_notice 或 context_usage 时，跳过整个事件（含其 data 行）
 */
export function filterSSEEvents(rawChunk: string, log: FastifyInstance['log']): string {
  const lines = rawChunk.split('\n');
  const outputLines: string[] = [];
  let skipCurrentEvent = false;

  for (const line of lines) {
    if (line.startsWith('event:')) {
      const eventType = line.slice(6).trim();
      skipCurrentEvent = BLOCKED_SSE_EVENTS.has(eventType);
      if (skipCurrentEvent) {
        log.debug(`filtered SSE event: ${eventType}`);
        continue;
      }
    }

    if (skipCurrentEvent) {
      if (line === '') {
        skipCurrentEvent = false;
      }
      continue;
    }

    outputLines.push(line);
  }

  return outputLines.join('\n');
}

/**
 * 清理讯飞特有字段：reasoning_content 和 plugins_content
 * ai-sdk/openai-compatible 的 Zod schema 不认识这些字段，可能导致验证失败
 */
export function cleanXfyunFields(chunk: string): string {
  return chunk
    .replace(/,"reasoning_content"\s*:\s*"[^"]*"/g, '')
    .replace(/"reasoning_content"\s*:\s*"[^"]*",?/g, '')
    .replace(/,"plugins_content"\s*:\s*null/g, '');
}

/**
 * 带重试的 fetch 请求
 *
 * @param readBody - 是否读取响应体
 *   true:  非流式请求，读取 body 以检测讯飞业务层错误码（如 10012）
 *   false: 流式请求，不提前消费 body，保留 ReadableStream 供 SSE 透传；
 *          此时仅通过 HTTP 状态码判断是否重试
 *
 * 重试策略：指数退避，初始延迟 delayMs，每次翻倍，最多 maxRetries 次
 * 重试条件：
 *   - HTTP 429 / 503（readBody=true 或 false 均生效）
 *   - 响应体包含讯飞错误码 10012（仅 readBody=true 时检测）
 *   - 网络层异常（fetch 抛错，如连接超时、DNS 失败）
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number,
  delayMs: number,
  readBody: boolean,
  log: FastifyInstance['log'],
): Promise<{ response: Response; body: string | null; retries: number }> {
  let lastError: Error | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 上游 fetch 超时 120s，避免讯飞侧挂住后本地 socket 被无限占用
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(120_000),
      });

      if (readBody) {
        // 非流式：读取完整 body，可检测讯飞业务层错误码
        const body = await response.text();

        // 判断是否需要重试：HTTP 状态码 或 讯飞业务错误码
        const shouldRetry =
          RETRYABLE_STATUS_CODES.has(response.status) || isRetryableXfyunError(body);

        if (!shouldRetry) {
          // 用已读取的 body 重建 Response，因为 body 只能消费一次
          return {
            response: new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }),
            body,
            retries,
          };
        }

        // 达到最大重试次数，返回最后一次的响应
        if (attempt >= maxRetries) {
          return {
            response: new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }),
            body,
            retries,
          };
        }

        // 指数退避等待后重试
        const backoff = delayMs * Math.pow(2, attempt);
        const reason = RETRYABLE_STATUS_CODES.has(response.status)
          ? `HTTP ${response.status}`
          : 'xfyun code in body';
        log.warn(`${reason} on attempt ${attempt + 1}, retrying in ${backoff}ms...`);
        await sleep(backoff);
        retries++;
        log.debug(`retry #${retries} sending request to ${url} (readBody=${readBody})`);
      } else {
        // 流式：不读取 body，仅通过 HTTP 状态码判断重试
        if (!RETRYABLE_STATUS_CODES.has(response.status)) {
          return { response, body: null, retries };
        }

        // 达到最大重试次数，返回最后一次的响应
        if (attempt >= maxRetries) {
          return { response, body: null, retries };
        }

        // 指数退避等待后重试
        const backoff = delayMs * Math.pow(2, attempt);
        log.warn(`HTTP ${response.status} on attempt ${attempt + 1}, retrying in ${backoff}ms...`);
        await sleep(backoff);
        retries++;
        log.debug(`retry #${retries} sending request to ${url} (readBody=${readBody})`);
      }
    } catch (err) {
      lastError = err as Error;

      // 网络异常：达到最大重试次数则抛出，否则退避后重试
      if (attempt >= maxRetries) {
        throw lastError;
      }

      const backoff = delayMs * Math.pow(2, attempt);
      log.warn(
        `network error on attempt ${attempt + 1}: ${lastError.message}, retrying in ${backoff}ms...`,
      );
      await sleep(backoff);
      retries++;
      log.debug(`retry #${retries} sending request to ${url} after network error`);
    }
  }

  throw lastError || new Error('All retries exhausted');
}

/**
 * 代理请求处理主函数
 *
 * 流程：
 * 1. 强制覆盖 model 为 astron-code-latest
 * 2. 构建上游请求（白名单 headers + API Key 注入 + 路径重写）
 * 3. 带重试地转发请求
 * 4. 根据流式/非流式分别处理响应
 *    - 非流式：直接返回 JSON
 *    - 流式：先缓存所有 SSE chunks 检测讯飞错误码，正常则透传，异常则降级重试
 */
export async function handleProxy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const startTime = Date.now();
  const body = request.body as Record<string, unknown> | undefined;

  // 兼容处理：部分客户端可能将 stream 传为字符串 "true" 而非布尔值
  // 讯飞上游要求 stream 为布尔类型，字符串会导致 Go JSON 反序列化报错
  const isStream = body?.stream === true || body?.stream === 'true';
  if (body && typeof body.stream === 'string') {
    body.stream = body.stream === 'true';
  }

  // ---- 步骤 1：强制固定模型名 ----
  const model = 'astron-code-latest';
  if (body) {
    body.model = model;
  }

  // ---- 步骤 2：构建上游请求 ----
  const upstreamUrl = buildUpstreamUrl(request.url);

  // 仅转发白名单 headers，其余丢弃
  // 原因：部分 IDE（如 Trae）会添加 destination-domain 等非标准 header，
  // 讯飞服务端会因 header 值不符合 RFC1035 而返回 400
  const ALLOWED_UPSTREAM_HEADERS = new Set(['x-request-id', 'x-correlation-id']);

  // 构建上游请求 headers：注入 API Key，替换客户端传入的 Authorization
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };

  // 从客户端 headers 中提取白名单项
  for (const [key, value] of Object.entries(request.headers)) {
    const lower = key.toLowerCase();
    if (ALLOWED_UPSTREAM_HEADERS.has(lower) && typeof value === 'string') {
      headers[key] = value;
    }
  }

  // ---- 步骤 3：带重试地转发请求 ----
  // 非流式请求读取 body 以检测讯飞错误码，流式请求保留 ReadableStream
  const {
    response,
    body: responseBodyText,
    retries,
  } = await fetchWithRetry(
    upstreamUrl,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    config.maxRetries,
    config.retryDelay,
    !isStream,
    request.log,
  );

  const durationMs = Date.now() - startTime;

  // ---- 步骤 4：处理响应 ----

  // 4a. 非流式请求的上游错误：直接透传错误响应
  if (!response.ok && !isStream && responseBodyText) {
    request.log.error(
      {
        model,
        status: response.status,
        durationMs,
        retries,
        error: responseBodyText.slice(0, 500),
      },
      'upstream error',
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;

    reply.status(response.status);
    reply.send(responseBodyText);
    return;
  }

  // 4b. 流式请求：解析 SSE 事件，过滤非标准事件，实时透传
  if (isStream && response.body) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = response.body.getReader();
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const rawChunk = Buffer.from(value).toString('utf-8');
        const filtered = filterSSEEvents(rawChunk, request.log);
        const cleaned = cleanXfyunFields(filtered);

        reply.raw.write(cleaned);

        if (isRetryableXfyunError(rawChunk)) {
          request.log.warn(
            'xfyun retryable error detected in stream (cannot retry, headers already sent)',
          );
        }

        const usageMatch = rawChunk.match(
          /"prompt_tokens":\s*(\d+).*?"completion_tokens":\s*(\d+)/,
        );
        if (usageMatch) {
          promptTokens = parseInt(usageMatch[1], 10);
          completionTokens = parseInt(usageMatch[2], 10);
        }
      }
    } finally {
      reader.releaseLock();
      reply.raw.end();
    }

    const tokenInfo =
      promptTokens !== undefined
        ? `in=${fmtTokens(promptTokens)} out=${fmtTokens(completionTokens!)} total=${fmtTokens((promptTokens ?? 0) + (completionTokens ?? 0))}`
        : '';
    request.log.info(
      {
        model,
        status: 200,
        durationMs,
        promptTokens,
        completionTokens,
        retries,
      },
      `stream completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
    );
    sessionStats.requestCount++;
    sessionStats.totalPromptTokens += promptTokens ?? 0;
    sessionStats.totalCompletionTokens += completionTokens ?? 0;
    sessionStats.retries += retries;
    return;
  }

  // 4c. 非流式请求的正常响应：解析 JSON，清理讯飞特有字段后返回
  const responseBody = JSON.parse(responseBodyText!) as Record<string, unknown>;

  // 清理 choices[].message 中的讯飞特有字段
  const choices = responseBody.choices as Array<Record<string, unknown>> | undefined;
  if (choices) {
    for (const choice of choices) {
      const message = choice.message as Record<string, unknown> | undefined;
      if (message) {
        delete message.plugins_content;
        delete message.reasoning_content;
      }
    }
  }

  const usage = responseBody.usage as Record<string, unknown> | undefined;
  const usageInfo = extractTokenUsage(usage || {});

  const tokenInfo =
    usageInfo.promptTokens !== undefined
      ? `in=${fmtTokens(usageInfo.promptTokens!)} out=${fmtTokens(usageInfo.completionTokens!)} total=${fmtTokens((usageInfo.promptTokens ?? 0) + (usageInfo.completionTokens ?? 0))}`
      : '';
  request.log.info(
    {
      model,
      status: response.status,
      durationMs,
      promptTokens: usageInfo.promptTokens,
      completionTokens: usageInfo.completionTokens,
      retries,
    },
    `request completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
  );

  sessionStats.requestCount++;
  sessionStats.totalPromptTokens += usageInfo.promptTokens ?? 0;
  sessionStats.totalCompletionTokens += usageInfo.completionTokens ?? 0;
  sessionStats.retries += retries;
  if (!response.ok) sessionStats.errors++;

  reply.status(response.status);
  reply.send(responseBody);
}

/**
 * GET 请求透传代理（如 /v1/models）
 * 不注入 body、不覆盖 model、不做 SSE 过滤，仅路径重写 + API Key 注入 + 透传响应
 */
export async function handleGetProxy(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const upstreamUrl = buildUpstreamUrl(request.url);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };

  const response = await fetch(upstreamUrl, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const body = await response.text();

  request.log.info(
    { status: response.status, url: request.url },
    `GET proxied | ${response.status}`,
  );

  sessionStats.requestCount++;

  reply.status(response.status);
  reply.header('Content-Type', response.headers.get('content-type') || 'application/json');
  reply.send(body);
}
