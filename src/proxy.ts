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

/**
 * 从讯飞响应体中提取错误详情
 * 支持多种格式：
 *   - {"code":10012,"msg":"EngineInternalError:error"}
 *   - {"error":{"code":"ModelArts.81001","message":"..."}}
 *   - SSE 格式 data:{"error":{...}}
 */
export function extractXfyunError(body: string): { code?: string | number; msg?: string } | null {
  // 尝试去掉 SSE data: 前缀
  const jsonStr = body.replace(/^data:\s*/m, '').trim();
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // 格式1: {"code": 10012, "msg": "..."}
    if (parsed.code !== undefined) {
      return { code: parsed.code as string | number, msg: parsed.msg as string | undefined };
    }

    // 格式2: {"error": {"code": "ModelArts.81001", "message": "..."}}
    const error = parsed.error as Record<string, unknown> | undefined;
    if (error) {
      return {
        code: (error.code ?? parsed.error_code) as string | number | undefined,
        msg: (error.message ?? parsed.error_msg) as string | undefined,
      };
    }
  } catch {
    // JSON 解析失败，尝试正则提取
    const codeMatch = body.match(/"code"\s*:\s*(\d+)/);
    const msgMatch = body.match(/"msg"\s*:\s*"([^"]*)"/);
    if (codeMatch || msgMatch) {
      return {
        code: codeMatch ? codeMatch[1] : undefined,
        msg: msgMatch ? msgMatch[1] : undefined,
      };
    }
  }
  return null;
}

/**
 * 提取 messages 中 content 类型分布，用于日志排查
 * 例如: "3 text, 2 image_url"
 */
function summarizeContentTypes(body: Record<string, unknown> | undefined): string {
  if (!body) return 'no body';
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(messages)) return 'no messages';

  const counts: Record<string, number> = {};
  for (const msg of messages) {
    const content = msg.content;
    if (typeof content === 'string') {
      counts['text'] = (counts['text'] || 0) + 1;
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'object' && item !== null) {
          const type = (item as Record<string, unknown>).type as string;
          if (type) counts[type] = (counts[type] || 0) + 1;
        }
      }
    }
  }
  const parts = Object.entries(counts).map(([t, c]) => `${c} ${t}`);
  return parts.length > 0 ? `${messages.length} msgs: ${parts.join(', ')}` : `${messages.length} msgs`;
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
 * 有状态的 SSE 事件过滤器
 *
 * 解决核心问题：TCP 流的 chunk 边界是任意的，一个 SSE 行可能被拆成多个 chunk。
 * 例如 "event: progress_notice" 可能被拆成：
 *   chunk1: "event: progress"
 *   chunk2: "_notice\ndata: ..."
 * 无状态按 chunk 独立处理会漏过滤，导致 Trae IDE 收到非标准事件后报 4054。
 *
 * 状态：
 *   pendingLine  — 上一 chunk 末尾未以 \n 结尾的不完整行，下次 filter() 时拼到首行
 *   skipCurrentEvent — 当前事件是否正在被跳过
 */
export class SSEFilter {
  private pendingLine = '';
  private skipCurrentEvent = false;

  /**
   * 过滤一个 chunk 中的 SSE 事件
   * 跨 chunk 维护状态，确保 event: 行完整后再判断是否过滤
   */
  filter(rawChunk: string, log: FastifyInstance['log']): string {
    const text = this.pendingLine + rawChunk;

    // 找到最后一个换行符的位置，之前的行是完整的，之后是不完整行留到下次
    const lastNewline = text.lastIndexOf('\n');

    if (lastNewline === -1) {
      // 整个 chunk 没有换行符，全部缓冲
      this.pendingLine = text;
      return '';
    }

    const completeText = text.slice(0, lastNewline);
    this.pendingLine = text.slice(lastNewline + 1);

    const lines = completeText.split('\n');
    const outputLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        const eventType = line.slice(6).trim();
        this.skipCurrentEvent = BLOCKED_SSE_EVENTS.has(eventType);
        if (this.skipCurrentEvent) {
          log.debug(`filtered SSE event: ${eventType}`);
          continue;
        }
      }

      if (this.skipCurrentEvent) {
        if (line === '') {
          this.skipCurrentEvent = false;
        }
        continue;
      }

      outputLines.push(line);
    }

    // 用 \n 重建，并在末尾补 \n 恢复原始换行符
    return outputLines.length > 0 ? outputLines.join('\n') + '\n' : '';
  }
}

/**
 * 无状态 SSE 过滤便捷函数（向后兼容）
 * 对完整 SSE 文本做一次性过滤，不处理跨 chunk 分割
 */
export function filterSSEEvents(rawChunk: string, log: FastifyInstance['log']): string {
  const filter = new SSEFilter();
  return filter.filter(rawChunk, log);
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
        // 注意：讯飞可能用 10012 表示"不支持的 content type"并返回 HTTP 400，
        // 这种客户端错误不应重试，只有 HTTP 200 中的讯飞业务错误码才值得重试
        const isClientError = response.status >= 400 && response.status < 500;
        const shouldRetry =
          RETRYABLE_STATUS_CODES.has(response.status) ||
          (!isClientError && isRetryableXfyunError(body));

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
        const xfyunErr = extractXfyunError(body);
        const reason = RETRYABLE_STATUS_CODES.has(response.status)
          ? `HTTP ${response.status}`
          : `xfyun_code=${xfyunErr?.code} msg=${xfyunErr?.msg}`;
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

  const isStream = body?.stream === true || body?.stream === 'true';
  if (body && typeof body.stream === 'string') {
    body.stream = body.stream === 'true';
  }

  const model = 'astron-code-latest';
  if (body) {
    body.model = model;
  }

  request.log.info(
    `request incoming | ${request.url} | stream=${isStream} | ${summarizeContentTypes(body)}`,
  );

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
    const xfyunErr = extractXfyunError(responseBodyText);
    const errDetail = xfyunErr ? ` | xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg}` : '';
    request.log.error(
      `upstream error | ${response.status} | ${durationMs}ms | retries=${retries}${errDetail} | body=${responseBodyText.slice(0, 300)}`,
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;

    reply.status(response.status);
    reply.send(responseBodyText);
    return;
  }

  // 4a2. 非流式请求上游错误但 body 为空（不应发生，防御性处理）
  if (!response.ok && !isStream && !responseBodyText) {
    request.log.error(
      `upstream error with empty body | ${response.status} | ${durationMs}ms | retries=${retries}`,
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;

    reply.status(response.status);
    reply.send({
      error: {
        message: `upstream returned ${response.status} with empty body`,
        type: 'upstream_error',
        code: response.status,
      },
    });
    return;
  }

  // 4b. 流式请求上游返回非 2xx 且无 body（无法建立 SSE 流）
  if (isStream && !response.ok && !response.body) {
    request.log.error(
      `stream upstream error with no body | ${response.status} | ${durationMs}ms | retries=${retries}`,
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;

    reply.status(response.status);
    reply.send({
      error: {
        message: `upstream returned ${response.status} with no stream body`,
        type: 'upstream_error',
        code: response.status,
      },
    });
    return;
  }

  // 4c. 流式请求：解析 SSE 事件，过滤非标准事件，实时透传
  if (isStream && response.body) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = response.body.getReader();
    const sseFilter = new SSEFilter();
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const rawChunk = Buffer.from(value).toString('utf-8');
        const filtered = sseFilter.filter(rawChunk, request.log);
        const cleaned = cleanXfyunFields(filtered);

        reply.raw.write(cleaned);

        if (isRetryableXfyunError(rawChunk)) {
          const xfyunErr = extractXfyunError(rawChunk);
          const errDetail = xfyunErr ? `code=${xfyunErr.code} msg=${xfyunErr.msg}` : 'unknown';
          request.log.warn(
            `xfyun retryable error in stream (cannot retry, headers already sent) | ${errDetail}`,
          );
        }

        if (!isRetryableXfyunError(rawChunk) && rawChunk.includes('"error"')) {
          const xfyunErr = extractXfyunError(rawChunk);
          if (xfyunErr) {
            request.log.warn(
              `upstream error in stream | code=${xfyunErr.code} msg=${xfyunErr.msg}`,
            );
          }
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
      `stream completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
    );
    sessionStats.requestCount++;
    sessionStats.totalPromptTokens += promptTokens ?? 0;
    sessionStats.totalCompletionTokens += completionTokens ?? 0;
    sessionStats.retries += retries;
    return;
  }

  // 4d. 非流式请求的正常响应：解析 JSON，清理讯飞特有字段后返回
  if (!responseBodyText) {
    request.log.error(
      `non-stream response with null body | ${response.status} | ${durationMs}ms | retries=${retries}`,
    );
    reply.status(500).send({
      error: {
        message: 'upstream returned empty response body',
        type: 'upstream_error',
        code: 500,
      },
    });
    sessionStats.requestCount++;
    sessionStats.errors++;
    return;
  }

  const responseBody = JSON.parse(responseBodyText) as Record<string, unknown>;

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

  request.log.info(`GET proxied | ${response.status} | ${request.url}`);

  sessionStats.requestCount++;

  reply.status(response.status);
  reply.header('Content-Type', response.headers.get('content-type') || 'application/json');
  reply.send(body);
}
