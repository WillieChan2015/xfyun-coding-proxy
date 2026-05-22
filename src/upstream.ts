/**
 * 共享上游服务层
 *
 * 从 proxy.ts 和 anthropic/handler.ts 中提取的共享逻辑，
 * 包括重试、SSE 过滤、讯飞字段清理、以及统一的 upstreamRequest() 函数。
 */

import { FastifyInstance } from 'fastify';
import { config, DEFAULT_MODEL } from './config';
import { readWithTimeout } from './util';
import { extractTokenUsage, fmtTokens } from './util';
import { rolloverDailyStats, recordRequestComplete, recordRequestStart, requestStarted, requestFinished, streamingStarted, streamingFinished, Protocol } from './stats';

// HTTP 状态码级别的重试条件：429 限流、500 上游内部错误（含超时）、503 服务过载
export const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

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
export function extractXfyunError(body: string): { code?: string | number; msg?: string; sid?: string } | null {
  // 尝试去掉 SSE data: 前缀
  const jsonStr = body.replace(/^data:\s*/m, '').trim();
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // 格式1: {"code": 10012, "msg": "..."}
    if (parsed.code !== undefined) {
      const msg = parsed.msg as string | undefined;
      return {
        code: parsed.code as string | number,
        msg,
        sid: extractSidFromMsg(msg) ?? extractSidFromBody(body),
      };
    }

    // 格式2: {"error": {"code": "ModelArts.81001", "message": "..."}}
    const error = parsed.error as Record<string, unknown> | undefined;
    if (error) {
      const msg = (error.message ?? parsed.error_msg) as string | undefined;
      return {
        code: (error.code ?? parsed.error_code) as string | number | undefined,
        msg,
        sid: extractSidFromMsg(msg) ?? extractSidFromBody(body),
      };
    }
  } catch {
    // JSON 解析失败，尝试正则提取
    const codeMatch = body.match(/"code"\s*:\s*(\d+)/);
    const msgMatch = body.match(/"msg"\s*:\s*"([^"]*)"/);
    if (codeMatch || msgMatch) {
      const msg = msgMatch ? msgMatch[1] : undefined;
      return {
        code: codeMatch ? codeMatch[1] : undefined,
        msg,
        sid: extractSidFromMsg(msg) ?? extractSidFromBody(body),
      };
    }
  }
  return null;
}

/**
 * 从讯飞错误 msg 中提取 Sid
 * 格式: "Xunfei request failed with Sid: cht000b3fc4@dx19e0072f47eb958700 code: 10012, msg: ..."
 */
function extractSidFromMsg(msg: string | undefined): string | undefined {
  if (!msg) return undefined;
  const match = msg.match(/Sid:\s*(cht[\w@]+)/);
  return match ? match[1] : undefined;
}

/**
 * 从响应体中直接提取 Sid（兜底）
 */
function extractSidFromBody(body: string): string | undefined {
  const match = body.match(/"sid"\s*:\s*"(cht[^"]+)"/);
  return match ? match[1] : undefined;
}

/**
 * 提取 messages 中 content 类型分布，用于日志排查
 * 例如: "3 text, 2 image_url"
 */
export function summarizeContentTypes(body: Record<string, unknown> | undefined): string {
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

export interface RequestDiagnostics {
  model: string;
  stream: boolean;
  messageCount: number;
  contentTypes: string;
  maxTokens: number | null;
  toolCount: number;
  requestBytes: number;
}

export function summarizeRequestDiagnostics(
  body: Record<string, unknown> | undefined,
  model: string,
  isStream: boolean,
): RequestDiagnostics {
  if (!body) {
    return { model, stream: isStream, messageCount: 0, contentTypes: 'no body', maxTokens: null, toolCount: 0, requestBytes: 0 };
  }

  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const contentTypes = summarizeContentTypes(body);
  const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : null;
  const tools = body.tools as Array<unknown> | undefined;
  const toolCount = Array.isArray(tools) ? tools.length : 0;
  const requestBytes = JSON.stringify(body).length;

  return { model, stream: isStream, messageCount, contentTypes, maxTokens, toolCount, requestBytes };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从 SSE rawChunk 中提取 token 用量
 * 支持两种格式：
 *   1. 标准 OpenAI usage：{"prompt_tokens":N,"completion_tokens":N}（仅当值 > 0 时返回）
 *   2. 讯飞 context_usage 事件：{"tokens":N}（独立 key，非 total_tokens；仅当 N > 0 时返回）
 *
 * 一个 rawChunk 可能包含多个 SSE 事件（中间事件 usage 为 0，最后事件为真实值），
 * 因此用全局匹配取最后一个非零结果。
 */
export function extractStreamUsage(rawChunk: string): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  // 标准格式：全局匹配所有 prompt_tokens+completion_tokens 对，取最后一个非零值
  const usageRegex = /"prompt_tokens":\s*(\d+).*?"completion_tokens":\s*(\d+)/g;
  let lastPt: number | undefined;
  let lastCt: number | undefined;
  let match: RegExpExecArray | null;
  while ((match = usageRegex.exec(rawChunk)) !== null) {
    const pt = parseInt(match[1], 10);
    const ct = parseInt(match[2], 10);
    if (pt > 0 || ct > 0) {
      lastPt = pt;
      lastCt = ct;
    }
  }
  if (lastPt !== undefined) {
    return { promptTokens: lastPt, completionTokens: lastCt };
  }

  // 讯飞 context_usage 格式：{"tokens":N} 作为独立 key（非 "total_tokens"）
  const contextRegex = /(?<!total_)"tokens":\s*(\d+)/g;
  let lastTotal: number | undefined;
  while ((match = contextRegex.exec(rawChunk)) !== null) {
    const t = parseInt(match[1], 10);
    if (t > 0) {
      lastTotal = t;
    }
  }
  if (lastTotal !== undefined) {
    return { totalTokens: lastTotal };
  }

  return {};
}

/**
 * 路径重写：客户端请求 /v1/* → 上游 /v2/*
 * 也支持 /ollama/v1/* → 上游 /v2/*（VS Code Continue.dev 等工具的 Ollama OpenAI 兼容路径）
 * 讯飞 Coding Plan 的 OpenAI 协议端点使用 /v2 前缀
 */
export function rewritePath(originalPath: string): string {
  return originalPath.replace(/^\/ollama\/v1/, '/v1').replace(/^\/v1/, '');
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

// SSE 事件类型白名单：只转发标准 OpenAI 兼容事件
// OpenAI SSE 规范中，默认事件类型是 "message"（无 event: 行时等同于 event: message）
// 讯飞会发送 progress_notice、context_usage 等非标准事件，
// Trae IDE 的 SSE 解析器遇到不认识的 event 类型会终止流并报 4054
// 参考：https://github.com/Trae-AI/Trae/issues/2466
// 白名单策略比黑名单更安全：讯飞可能新增任何非标准事件，黑名单无法覆盖
export const ALLOWED_SSE_EVENTS = new Set(['message']);

/**
 * 有状态的 SSE 事件过滤器（白名单策略）
 *
 * 只转发 ALLOWED_SSE_EVENTS 中的事件类型（"message"）和无 event: 行的默认事件。
 * 任何不在白名单中的 event: 类型都会被整事件跳过（含其 data 行）。
 *
 * 解决核心问题：TCP 流的 chunk 边界是任意的，一个 SSE 行可能被拆成多个 chunk。
 * 例如 "event: progress_notice" 可能被拆成：
 *   chunk1: "event: progress"
 *   chunk2: "_notice\ndata: ..."
 * 无状态按 chunk 独立处理会漏过滤，导致 Trae IDE 收到非标准事件后报 4054。
 */
export class SSEFilter {
  private pendingLine = '';
  private skipCurrentEvent = false;
  private allowedEvents: Set<string>;

  constructor(allowedEvents: Set<string> = ALLOWED_SSE_EVENTS) {
    this.allowedEvents = allowedEvents;
  }

  /**
   * 过滤一个 chunk 中的 SSE 事件
   * 跨 chunk 维护状态，确保 event: 行完整后再判断是否转发
   */
  filter(rawChunk: string, log: FastifyInstance['log']): string {
    const text = this.pendingLine + rawChunk;

    const lastNewline = text.lastIndexOf('\n');

    if (lastNewline === -1) {
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
        this.skipCurrentEvent = !this.allowedEvents.has(eventType);
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
export async function fetchWithRetry(
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
          : `xfyun_code=${xfyunErr?.code} msg=${xfyunErr?.msg} sid=${xfyunErr?.sid ?? 'n/a'}`;
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

// ---- upstreamRequest 统一上游请求函数 ----

export interface UpstreamOptions {
  protocol: Protocol;
  upstreamUrl: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
  isStream: boolean;
  allowedSSEEvents?: Set<string>;
  extractStreamUsage?: (rawChunk: string) => { inputTokens?: number; outputTokens?: number };
  extractNonStreamUsage?: (body: Record<string, unknown>) => { promptTokens?: number; completionTokens?: number };
  cleanNonStreamBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  cleanStreamChunk?: (chunk: string) => string;
  formatStreamErrorEvent: (errMsg: string) => string;
  request: { id: string; url: string; headers: Record<string, string | string[] | undefined>; log: FastifyInstance['log'] };
  rawReply: { write: (data: string | Buffer) => boolean; end: () => void };
  diagnostics?: RequestDiagnostics;
}

export interface UpstreamResult {
  responseBody: Record<string, unknown> | null;
  errorBody: string | null;
  status: number;
  retries: number;
  success: boolean;
  errorType?: 'network' | 'upstream' | 'empty_body' | 'no_stream_body' | 'stream_error';
  error?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/**
 * 统一上游请求处理函数
 *
 * 封装了 OpenAI 和 Anthropic 协议共享的上游请求逻辑：
 * - rolloverDailyStats + requestStarted
 * - fetchWithRetry 调用
 * - 网络错误处理 + stats
 * - 非流式上游错误 + stats
 * - 非流式空 body 错误 + stats
 * - 流式无 body 错误 + stats
 * - 流式 SSE 循环（SSEFilter + xfyun 错误检测 + usage 提取）+ stats
 * - 非流式正常响应（JSON 解析 + 字段清理 + usage）+ stats
 *
 * 设计决策：
 * 1. 不直接发送 HTTP 响应（流式数据除外），返回结构化 UpstreamResult 供 handler 格式化
 * 2. 流式数据通过 rawReply.write() 实时写入（时序要求）
 * 3. 流式错误也通过 rawReply.write() 写入（headers 已发送，无法更改状态码）
 * 4. rawReply.end() 在 finally 块中调用
 */
export async function upstreamRequest(options: UpstreamOptions): Promise<UpstreamResult> {
  const {
    protocol,
    upstreamUrl,
    headers,
    body,
    isStream,
    allowedSSEEvents,
    extractStreamUsage: extractStreamUsageFn,
    extractNonStreamUsage: extractNonStreamUsageFn,
    cleanNonStreamBody,
    cleanStreamChunk,
    formatStreamErrorEvent,
    request: reqInfo,
    rawReply,
    diagnostics,
  } = options;

  // 入口 rollover：确保 dailyStats 在请求处理前已切换到当天；
  // 出口 rollover（recordRequestComplete 内）处理跨天完成的边界情况，两者互补
  rolloverDailyStats(config.logDir);
  requestStarted();

  const startTime = Date.now();
  // const model = body?.model as string ?? 'unknown';
  const model = DEFAULT_MODEL;
  const ua = typeof reqInfo.headers['user-agent'] === 'string'
    ? reqInfo.headers['user-agent']
    : 'unknown';
  const reqId = reqInfo.id;
  const reqPath = reqInfo.url;

  recordRequestStart(protocol, model, reqId, reqPath, ua, isStream);

  // ---- 带重试地转发请求 ----
  let response: Awaited<ReturnType<typeof fetchWithRetry>>['response'];
  let responseBodyText: string | null;
  let retries: number;

  try {
    const result = await fetchWithRetry(
      upstreamUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      config.maxRetries,
      config.retryDelay,
      !isStream,
      reqInfo.log,
    );
    response = result.response;
    responseBodyText = result.body;
    retries = result.retries;
  } catch (err) {
    // fetchWithRetry 网络异常（超时、DNS 失败等）
    const errMsg = err instanceof Error ? err.message : String(err);
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(`upstream fetch error | ${Date.now() - startTime}ms | ${errMsg}${diagStr}`);

    const durationMs = Date.now() - startTime;
    recordRequestComplete({
      protocol,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: durationMs,
      success: false,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries: 0,
      error: errMsg,
    });
    requestFinished();

    return {
      responseBody: null,
      errorBody: null,
      status: 502,
      retries: 0,
      success: false,
      errorType: 'network',
      error: errMsg,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  const durationMs = Date.now() - startTime;

  // ---- 处理响应 ----

  // 非流式请求的上游错误：直接透传错误响应
  if (!response.ok && !isStream && responseBodyText) {
    const xfyunErr = extractXfyunError(responseBodyText);
    const errDetail = xfyunErr ? ` | xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg} sid=${xfyunErr.sid ?? 'n/a'}` : '';
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(
      `upstream error | ${response.status} | ${durationMs}ms | retries=${retries}${errDetail}${diagStr} | body=${responseBodyText.slice(0, 300)}`,
    );

    recordRequestComplete({
      protocol,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: durationMs,
      success: false,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries,
      error: `HTTP ${response.status}`,
    });
    requestFinished();

    return {
      responseBody: null,
      errorBody: responseBodyText,
      status: response.status,
      retries,
      success: false,
      errorType: 'upstream',
      error: `HTTP ${response.status}`,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  // 非流式请求上游错误但 body 为空（不应发生，防御性处理）
  if (!response.ok && !isStream && !responseBodyText) {
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(
      `upstream error with empty body | ${response.status} | ${durationMs}ms | retries=${retries}${diagStr}`,
    );

    recordRequestComplete({
      protocol,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: durationMs,
      success: false,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries,
      error: `HTTP ${response.status} empty body`,
    });
    requestFinished();

    return {
      responseBody: null,
      errorBody: null,
      status: response.status,
      retries,
      success: false,
      errorType: 'empty_body',
      error: `HTTP ${response.status} empty body`,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  // 流式请求上游返回非 2xx 且无 body（无法建立 SSE 流）
  if (isStream && !response.ok && !response.body) {
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(
      `stream upstream error with no body | ${response.status} | ${durationMs}ms | retries=${retries}${diagStr}`,
    );

    recordRequestComplete({
      protocol,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: durationMs,
      success: false,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries,
      error: `HTTP ${response.status} no stream body`,
    });
    requestFinished();

    return {
      responseBody: null,
      errorBody: null,
      status: response.status,
      retries,
      success: false,
      errorType: 'no_stream_body',
      error: `HTTP ${response.status} no stream body`,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  // 流式请求：解析 SSE 事件，过滤非标准事件，实时透传
  if (isStream && response.body) {
    streamingStarted();

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const sseFilter = new SSEFilter(allowedSSEEvents);
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: string | null = null;

    try {
      while (true) {
        const { done, value } = await readWithTimeout(reader, config.streamReadTimeout);
        if (done) break;

        const rawChunk = Buffer.from(value).toString('utf-8');
        const filtered = sseFilter.filter(rawChunk, reqInfo.log);
        const cleaned = cleanStreamChunk ? cleanStreamChunk(filtered) : cleanXfyunFields(filtered);

        rawReply.write(cleaned);

        if (isRetryableXfyunError(rawChunk)) {
          const xfyunErr = extractXfyunError(rawChunk);
          const errDetail = xfyunErr ? `code=${xfyunErr.code} msg=${xfyunErr.msg} sid=${xfyunErr.sid ?? 'n/a'}` : 'unknown';
          streamError = errDetail;
          reqInfo.log.warn(
            `xfyun retryable error in stream (cannot retry, headers already sent) | ${errDetail}`,
          );
          break;
        }

        if (!isRetryableXfyunError(rawChunk) && rawChunk.includes('"error"')) {
          const xfyunErr = extractXfyunError(rawChunk);
          if (xfyunErr) {
            streamError = `code=${xfyunErr.code} msg=${xfyunErr.msg} sid=${xfyunErr.sid ?? 'n/a'}`;
            reqInfo.log.warn(
              `upstream error in stream | ${streamError}`,
            );
            break;
          }
        }

        if (extractStreamUsageFn) {
          const usage = extractStreamUsageFn(rawChunk);
          if (usage.inputTokens !== undefined) {
            inputTokens = usage.inputTokens;
          }
          if (usage.outputTokens !== undefined) {
            outputTokens = usage.outputTokens;
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamError = errMsg;
      const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
      reqInfo.log.error(`stream error | ${durationMs}ms | ${errMsg}${diagStr}`);

      // 向 SSE 流发送错误事件，让客户端知道流异常终止
      rawReply.write(formatStreamErrorEvent(errMsg));
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
      try { rawReply.end(); } catch { /* client already closed */ }
      streamingFinished();
    }

    requestFinished();

    if (streamError) {
      const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
      reqInfo.log.error(`stream aborted | ${durationMs}ms | ${streamError}${diagStr}`);
      recordRequestComplete({
        protocol,
        model,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        latencyMs: durationMs,
        success: false,
        stream: isStream,
        requestId: reqId,
        path: reqPath,
        ua,
        retries,
        error: streamError,
      });

      return {
        responseBody: null,
        errorBody: null,
        status: response.status,
        retries,
        success: false,
        errorType: 'stream_error',
        error: streamError,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        durationMs,
      };
    }

    const tokenInfo =
      inputTokens !== undefined
        ? `in=${fmtTokens(inputTokens)} out=${fmtTokens(outputTokens ?? 0)} total=${fmtTokens(inputTokens + (outputTokens ?? 0))}`
        : '';
    reqInfo.log.info(
      `stream completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
    );
    recordRequestComplete({
      protocol,
      model,
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      latencyMs: durationMs,
      success: true,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries,
    });

    return {
      responseBody: null,
      errorBody: null,
      status: response.status,
      retries,
      success: true,
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      durationMs,
    };
  }

  // 非流式请求的正常响应：解析 JSON，清理讯飞特有字段后返回
  if (!responseBodyText) {
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(
      `non-stream response with null body | ${response.status} | ${durationMs}ms | retries=${retries}${diagStr}`,
    );

    recordRequestComplete({
      protocol,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: durationMs,
      success: false,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries,
      error: 'empty response body',
    });
    requestFinished();

    return {
      responseBody: null,
      errorBody: null,
      status: response.status,
      retries,
      success: false,
      errorType: 'empty_body',
      error: 'empty response body',
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  let responseBody: Record<string, unknown>;
  try {
    responseBody = JSON.parse(responseBodyText) as Record<string, unknown>;
  } catch {
    // 上游返回 HTTP 200 但响应体不是合法 JSON（如讯飞返回 {"code":10012,...} 非 OpenAI 格式）
    reqInfo.log.error(
      `non-stream response JSON parse failed | ${response.status} | ${durationMs}ms | retries=${retries} | body=${responseBodyText.slice(0, 300)}`,
    );

    recordRequestComplete({
      protocol,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: durationMs,
      success: false,
      stream: isStream,
      requestId: reqId,
      path: reqPath,
      ua,
      retries,
      error: `HTTP ${response.status} invalid JSON body`,
    });
    requestFinished();

    return {
      responseBody: null,
      errorBody: responseBodyText,
      status: response.status,
      retries,
      success: false,
      errorType: 'upstream',
      error: `HTTP ${response.status} invalid JSON body`,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  // 清理讯飞特有字段
  const finalBody = cleanNonStreamBody ? cleanNonStreamBody(responseBody) : responseBody;

  // 提取 usage
  let usageInfo: { promptTokens?: number; completionTokens?: number };
  if (extractNonStreamUsageFn) {
    const anthropicUsage = extractNonStreamUsageFn(finalBody);
    usageInfo = {
      promptTokens: anthropicUsage.promptTokens,
      completionTokens: anthropicUsage.completionTokens,
    };
  } else {
    usageInfo = extractTokenUsage(finalBody.usage as Record<string, unknown> || {});
  }

  const tokenInfo =
    usageInfo.promptTokens !== undefined
      ? `in=${fmtTokens(usageInfo.promptTokens!)} out=${fmtTokens(usageInfo.completionTokens!)} total=${fmtTokens((usageInfo.promptTokens ?? 0) + (usageInfo.completionTokens ?? 0))}`
      : '';
  reqInfo.log.info(
    `request completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
  );

  recordRequestComplete({
    protocol,
    model,
    inputTokens: usageInfo.promptTokens ?? 0,
    outputTokens: usageInfo.completionTokens ?? 0,
    latencyMs: durationMs,
    success: response.ok,
    stream: isStream,
    requestId: reqId,
    path: reqPath,
    ua,
    retries,
  });
  requestFinished();

  return {
    responseBody: finalBody,
    errorBody: null,
    status: response.status,
    retries,
    success: response.ok,
    inputTokens: usageInfo.promptTokens ?? 0,
    outputTokens: usageInfo.completionTokens ?? 0,
    durationMs,
  };
}
