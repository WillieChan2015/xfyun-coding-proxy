/**
 * 共享上游服务层
 *
 * 从 proxy.ts 和 anthropic/handler.ts 中提取的共享逻辑，
 * 包括重试、SSE 过滤、讯飞字段清理、以及统一的 upstreamRequest() 函数。
 */

import { FastifyInstance } from 'fastify';
import { config, DEFAULT_MODEL } from './config';
import { readWithTimeout, readBodyWithLimit } from './util';
import { extractTokenUsage, fmtTokens } from './util';
import { rolloverDailyStats, recordRequestComplete, recordRequestStart, requestStarted, requestFinished, streamingStarted, streamingFinished, Protocol } from './stats';
import { isDebugEnabled, debugLogUpstream, debugLogResponse } from './debug-logger';

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
 * 优先使用 JSON parse 确保准确性，失败时 fallback 到字符串匹配
 */
export function isRetryableXfyunError(responseBody: string): boolean {
  // 先尝试 JSON parse
  try {
    const parsed = JSON.parse(responseBody);
    if (typeof parsed.code === 'number' && RETRYABLE_XFYUN_CODES.has(parsed.code)) {
      return true;
    }
  } catch {
    // JSON parse 失败，fallback 到字符串匹配
    for (const code of RETRYABLE_XFYUN_CODES) {
      if (responseBody.includes(`"code":${code}`) || responseBody.includes(`"code": ${code}`)) {
        return true;
      }
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

// 退避上限：即使 maxRetries 很大，单次退避不超过 30s
const MAX_BACKOFF_MS = 30_000;

function calcBackoff(delayMs: number, attempt: number): number {
  const base = Math.min(delayMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
  return base + Math.random() * base * 0.3;
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
  // 快速判断：如果 chunk 不包含任何 usage 相关字段，跳过正则匹配
  if (!rawChunk.includes('"prompt_tokens"') && !rawChunk.includes('"tokens"')) {
    return {};
  }

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
 * 解析 SSE 行前缀，提取字段名和值
 *
 * SSE 规范中冒号后的空格是可选的：
 *   "data:content" 和 "data: content" 都合法
 *   "event:message" 和 "event: message" 都合法
 * 返回 { field, value } 或 null（非 SSE 行）
 */
export function parseSSELine(line: string): { field: string; value: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const field = line.slice(0, colonIdx);
  // 冒号后第一个空格可选，跳过它
  const valueStart = colonIdx + 1 + (line[colonIdx + 1] === ' ' ? 1 : 0);
  return { field, value: line.slice(valueStart) };
}

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
      const parsed = parseSSELine(line);
      if (parsed?.field === 'event') {
        this.skipCurrentEvent = !this.allowedEvents.has(parsed.value);
        if (this.skipCurrentEvent) {
          log.debug(`filtered SSE event: ${parsed.value}`);
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
 *
 * 支持两种输入格式：
 * 1. SSE 格式（data: {...}\n）— 实际运行时的流式 chunk
 * 2. 纯 JSON 字符串（{...}）— 非流式场景或测试用例
 *
 * 对每行尝试 JSON.parse → delete → JSON.stringify，
 * 解析失败的行保持原样（如 [DONE]），避免正则替换对转义引号和合法内容的误删
 */
export function cleanXfyunFields(chunk: string): string {
  if (!chunk.includes('reasoning_content') && !chunk.includes('plugins_content')) {
    return chunk;
  }

  const lines = chunk.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const parsed = parseSSELine(line);
    if (parsed?.field === 'data') {
      if (parsed.value === '[DONE]') {
        result.push(line);
        continue;
      }
      const cleaned = cleanXfyunJsonObj(parsed.value);
      result.push(cleaned !== null ? `data: ${cleaned}` : line);
    } else if (line.startsWith('{')) {
      const cleaned = cleanXfyunJsonObj(line);
      result.push(cleaned !== null ? cleaned : line);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/** 尝试 JSON.parse 清理讯飞字段，返回 JSON.stringify 结果；解析失败返回 null */
function cleanXfyunJsonObj(jsonStr: string): string | null {
  try {
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    if (cleanXfyunFieldsObj(obj)) {
      return JSON.stringify(obj);
    }
    return jsonStr;
  } catch {
    return null;
  }
}

/**
 * 直接在对象上清理讯飞特有字段（reasoning_content、plugins_content）
 * 避免多余的 JSON.stringify → cleanXfyunFields → JSON.parse 往返
 * @returns 对象是否被修改
 */
export function cleanXfyunFieldsObj(obj: Record<string, unknown>): boolean {
  let modified = false;
  if ('reasoning_content' in obj) { delete obj.reasoning_content; modified = true; }
  if ('plugins_content' in obj) { delete obj.plugins_content; modified = true; }
  const choices = obj.choices as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (delta) {
        if ('reasoning_content' in delta) { delete delta.reasoning_content; modified = true; }
        if ('plugins_content' in delta) { delete delta.plugins_content; modified = true; }
      }
      const message = choice.message as Record<string, unknown> | undefined;
      if (message) {
        if ('reasoning_content' in message) { delete message.reasoning_content; modified = true; }
        if ('plugins_content' in message) { delete message.plugins_content; modified = true; }
      }
    }
  }
  return modified;
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
 *   - HTTP 429 / 500 / 503（readBody=true 或 false 均生效）
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
      // 上游 fetch 超时：避免讯飞侧挂住后本地 socket 被无限占用
      // 注意：此超时从 fetch 调用时刻开始计算（绝对时间），流式长请求可能持续超过此时间；
      // 对于流式请求，实际空闲检测由 streamReadTimeout 负责
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(config.upstreamFetchTimeout),
      });

      if (readBody) {
        // 非流式：带大小限制读取 body，防止上游异常返回超大响应导致 OOM
        const body = await readBodyWithLimit(response);

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

        // 指数退避 + jitter 等待后重试（jitter 避免多客户端同时 429 时产生惊群效应）
        const backoff = calcBackoff(delayMs, attempt);
        const xfyunErr = extractXfyunError(body);
        const reason = RETRYABLE_STATUS_CODES.has(response.status)
          ? `HTTP ${response.status}`
          : `xfyun_code=${xfyunErr?.code} msg=${xfyunErr?.msg} sid=${xfyunErr?.sid ?? 'n/a'}`;
        log.warn(`${reason} on attempt ${attempt + 1}, retrying in ${Math.round(backoff)}ms...`);
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

        // 指数退避 + jitter 等待后重试
        const backoff = calcBackoff(delayMs, attempt);
        // 流式重试前释放未消费的 response.body，避免高并发下内存压力
        try { await response.body?.cancel(); } catch { /* cancel 失败不影响重试 */ }
        log.warn(`HTTP ${response.status} on attempt ${attempt + 1}, retrying in ${Math.round(backoff)}ms...`);
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

      const backoff = calcBackoff(delayMs, attempt);
      log.warn(
        `network error on attempt ${attempt + 1}: ${lastError.message}, retrying in ${Math.round(backoff)}ms...`,
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
  /** 流式请求确认上游 2xx 后写入的响应头，由各 handler 传入协议特定的 Content-Type 等 */
  streamHeaders?: Record<string, string>;
  allowedSSEEvents?: Set<string>;
  extractStreamUsage?: (rawChunk: string) => { inputTokens?: number; outputTokens?: number };
  extractNonStreamUsage?: (body: Record<string, unknown>) => { promptTokens?: number; completionTokens?: number };
  cleanNonStreamBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  cleanStreamChunk?: (chunk: string) => string;
  /** 流式输出转换：将过滤+清理后的 SSE 文本转换为最终写入客户端的格式（如 NDJSON） */
  streamTransform?: (cleanedChunk: string) => string[];
  formatStreamErrorEvent: (errMsg: string) => string;
  request: { id: string; url: string; headers: Record<string, string | string[] | undefined>; log: FastifyInstance['log'] };
  rawReply: { write: (data: string | Buffer) => boolean; end: () => void; writeHeader: (statusCode: number, headers: Record<string, string>) => void };
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
  // 防御性断言：确保 config 已通过 loadConfig() + validateConfig() 初始化
  if (!config.apiKey) {
    throw new Error('config.apiKey is empty — call loadConfig() + validateConfig() before handling requests');
  }

  const {
    protocol,
    upstreamUrl,
    headers,
    body,
    isStream,
    streamHeaders,
    allowedSSEEvents,
    extractStreamUsage: extractStreamUsageFn,
    extractNonStreamUsage: extractNonStreamUsageFn,
    cleanNonStreamBody,
    cleanStreamChunk,
    streamTransform,
    formatStreamErrorEvent,
    request: reqInfo,
    rawReply,
    diagnostics,
  } = options;

  // 入口 rollover：确保 dailyStats 在请求处理前已切换到当天；
  // 出口 rollover（recordRequestComplete 内）处理跨天完成的边界情况，两者互补
  rolloverDailyStats(config.logDir);
  requestStarted();
  // 流式请求从开始就计入 streaming 计数，而非等到 SSE 数据传输阶段
  if (isStream) streamingStarted();

  const startTime = Date.now();
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
    reqInfo.log.error(`upstream fetch error | ${Date.now() - startTime}ms | ${errMsg}${diagStr} | ua=${ua}`);

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
    if (isStream) streamingFinished();
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

  // 注意：此值在 fetchWithRetry 返回后计算，对于流式请求仅反映首字节延迟；
  // 流式 SSE 循环结束后会重新计算以覆盖完整耗时
  let durationMs = Date.now() - startTime;

  // ---- 处理响应 ----

  // 非流式请求的上游错误：直接透传错误响应
  if (!response.ok && !isStream && responseBodyText) {
    const xfyunErr = extractXfyunError(responseBodyText);
    const errDetail = xfyunErr ? ` | xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg} sid=${xfyunErr.sid ?? 'n/a'}` : '';
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(
      `upstream error | ${response.status} | ${durationMs}ms | retries=${retries}${errDetail}${diagStr} | ua=${ua} | body=${responseBodyText.slice(0, 300)}`,
    );

    if (isDebugEnabled()) {
      const upstreamHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { upstreamHeaders[k] = v; });
      debugLogUpstream(reqId, { statusCode: response.status, headers: upstreamHeaders, bodyChunks: [responseBodyText] });
    }

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
      error: `HTTP ${response.status}${xfyunErr ? ` xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg}` : ''}`,
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
      `upstream error with empty body | ${response.status} | ${durationMs}ms | retries=${retries}${diagStr} | ua=${ua}`,
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
      `stream upstream error with no body | ${response.status} | ${durationMs}ms | retries=${retries}${diagStr} | ua=${ua}`,
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
    streamingFinished();
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

  // 流式请求上游返回非 2xx 但有 body：读取错误 body 后返回错误，不进入流式循环
  if (isStream && !response.ok && response.body) {
    let errorBodyText: string | null = null;
    try {
      errorBodyText = await readBodyWithLimit(response);
    } catch {
      // body 读取失败，用 null errorBody 返回
    }
    const xfyunErr = errorBodyText ? extractXfyunError(errorBodyText) : null;
    const errDetail = xfyunErr ? ` | xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg} sid=${xfyunErr.sid ?? 'n/a'}` : '';
    const diagStr = diagnostics ? ` | diag=${JSON.stringify(diagnostics)}` : '';
    reqInfo.log.error(
      `stream upstream error | ${response.status} | ${durationMs}ms | retries=${retries}${errDetail}${diagStr} | ua=${ua} | body=${(errorBodyText ?? '').slice(0, 300)}`,
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
      error: `HTTP ${response.status}${xfyunErr ? ` xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg}` : ''}`,
    });
    streamingFinished();
    requestFinished();

    return {
      responseBody: null,
      errorBody: errorBodyText,
      status: response.status,
      retries,
      success: false,
      errorType: 'upstream',
      error: `HTTP ${response.status}${xfyunErr ? ` xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg}` : ''}`,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  }

  // 流式请求：确认上游 2xx 且有 body，写入流式响应头后开始 SSE 循环
  if (isStream && response.body) {
    // 延迟写入流式响应头：只有确认上游返回 2xx 且有 body 后才 writeHead，
    // 否则上游错误时可以正确透传 HTTP 状态码给客户端
    const hdrs = streamHeaders ?? {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    rawReply.writeHeader(200, hdrs);

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const sseFilter = new SSEFilter(allowedSSEEvents);
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: string | null = null;
    // debug 日志收集：仅在 debug 模式开启时分配数组
    const upstreamChunks: string[] | undefined = isDebugEnabled() ? [] : undefined;
    const responseChunks: string[] | undefined = isDebugEnabled() ? [] : undefined;

    try {
      while (true) {
        const { done, value } = await readWithTimeout(reader, config.streamReadTimeout);
        if (done) break;

        const rawChunk = Buffer.from(value).toString('utf-8');
        upstreamChunks?.push(rawChunk);
        const filtered = sseFilter.filter(rawChunk, reqInfo.log);
        const cleaned = cleanStreamChunk ? cleanStreamChunk(filtered) : cleanXfyunFields(filtered);

        if (streamTransform) {
          const lines = streamTransform(cleaned);
          for (const line of lines) {
            responseChunks?.push(line + '\n');
            rawReply.write(line + '\n');
          }
        } else {
          responseChunks?.push(cleaned);
          rawReply.write(cleaned);
        }

        const isRetryable = isRetryableXfyunError(rawChunk);
        if (isRetryable) {
          const xfyunErr = extractXfyunError(rawChunk);
          const errDetail = xfyunErr ? `code=${xfyunErr.code} msg=${xfyunErr.msg} sid=${xfyunErr.sid ?? 'n/a'}` : 'unknown';
          streamError = errDetail;
          reqInfo.log.warn(
            `xfyun retryable error in stream (cannot retry, headers already sent) | ${errDetail}`,
          );
          break;
        }

        if (!isRetryable && rawChunk.includes('"error"')) {
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
      reqInfo.log.error(`stream error | ${durationMs}ms | ${errMsg}${diagStr} | ua=${ua}`);

      // 向 SSE 流发送错误事件，让客户端知道流异常终止
      const errorEvent = formatStreamErrorEvent(errMsg);
      responseChunks?.push(errorEvent);
      rawReply.write(errorEvent);
    } finally {
      // 写入 debug 日志（在 rawReply.end() 之前，确保所有 chunk 已收集完毕）
      if (isDebugEnabled()) {
        const upstreamHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { upstreamHeaders[k] = v; });
        debugLogUpstream(reqId, { statusCode: response.status, headers: upstreamHeaders, bodyChunks: upstreamChunks! });
        debugLogResponse(reqId, { statusCode: 200, headers: hdrs as Record<string, string>, bodyChunks: responseChunks! });
      }
      try { reader.releaseLock(); } catch { /* already released */ }
      try { rawReply.end(); } catch { /* client already closed */ }
    }

    // 流式 SSE 循环已结束，重新计算完整耗时（含所有 chunk 的读取和透传）
    durationMs = Date.now() - startTime;

    streamingFinished();
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
      `stream completed | ${durationMs}ms | ${tokenInfo} | ua=${ua}`.replace(/ \| $/, ''),
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
      `non-stream response with null body | ${response.status} | ${durationMs}ms | retries=${retries}${diagStr} | ua=${ua}`,
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
      `non-stream response JSON parse failed | ${response.status} | ${durationMs}ms | retries=${retries} | ua=${ua} | body=${responseBodyText.slice(0, 300)}`,
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
    `request completed | ${durationMs}ms | ${tokenInfo} | ua=${ua}`.replace(/ \| $/, ''),
  );

  if (isDebugEnabled()) {
    const upstreamHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { upstreamHeaders[k] = v; });
    debugLogUpstream(reqId, { statusCode: response.status, headers: upstreamHeaders, bodyChunks: [responseBodyText!] });
    debugLogResponse(reqId, { statusCode: response.status, bodyChunks: [JSON.stringify(finalBody)] });
  }

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

// ---- 通用结果处理函数 ----

export interface ReplyLike {
  raw: { headersSent: boolean; write: (data: string) => void; end: () => void };
  sent: boolean;
  status: (code: number) => { send: (body: unknown) => void };
}

export interface ErrorFormatters {
  formatStreamErrorEvent: (errMsg: string) => string;
  formatNetworkErrorReply: (errMsg: string) => unknown;
  formatUpstreamErrorReply: (status: number, errorBody: string | null) => unknown;
  formatEmptyBodyErrorReply: (status: number) => unknown;
  formatNoStreamBodyErrorReply: (status: number) => unknown;
  formatNonStreamSuccess?: (result: UpstreamResult) => unknown;
}

/**
 * 安全发送 HTTP 响应：防止 ERR_HTTP_HEADERS_SENT 竞态
 *
 * 场景：upstreamRequest 返回错误结果时，handler 调用 reply.status().send()，
 * 但 Fastify 内部可能已经发送了 headers（如并发请求中 writeHeader 被调用、
 * 或 Fastify 的 requestTimeout 自动发送了响应），
 * 导致 reply.status().send() 触发 ERR_HTTP_HEADERS_SENT。
 *
 * 修复：reply.status().send() 失败时，fallback 到 raw.write + raw.end 写入 SSE 错误事件，
 * 确保客户端始终收到错误信息而非空 body。
 */
function safeSend(
  reply: ReplyLike,
  status: number,
  body: unknown,
  formatters: ErrorFormatters,
  errorMsg: string,
): void {
  if (reply.raw.headersSent) {
    // headers 已发送，只能通过 raw.write 写入 SSE 错误事件
    try {
      reply.raw.write(formatters.formatStreamErrorEvent(errorMsg));
    } catch { /* client already closed */ }
    try {
      reply.raw.end();
    } catch { /* client already closed */ }
    reply.sent = true;
    return;
  }
  try {
    reply.status(status).send(body);
  } catch (err) {
    // reply.status().send() 触发 ERR_HTTP_HEADERS_SENT：Fastify 内部状态异常
    // fallback 到 raw.write 写入 SSE 错误事件，确保客户端收到错误信息
    if (err instanceof Error && err.name === 'ERR_HTTP_HEADERS_SENT') {
      try {
        reply.raw.write(formatters.formatStreamErrorEvent(errorMsg));
      } catch { /* client already closed */ }
      try {
        reply.raw.end();
      } catch { /* client already closed */ }
      reply.sent = true;
      return;
    }
    // 其他异常直接抛出，由 Fastify 的 error handler 处理
    throw err;
  }
}

export function handleUpstreamResult(
  result: UpstreamResult,
  isStream: boolean,
  reply: ReplyLike,
  formatters: ErrorFormatters,
): void {
  if (result.errorType === 'network') {
    safeSend(
      reply, 502, formatters.formatNetworkErrorReply(result.error ?? 'unknown'),
      formatters, `upstream request failed: ${result.error ?? 'unknown'}`,
    );
    return;
  }

  if (result.errorType === 'upstream') {
    safeSend(
      reply, result.status, formatters.formatUpstreamErrorReply(result.status, result.errorBody),
      formatters, `upstream returned ${result.status}`,
    );
    return;
  }

  if (result.errorType === 'empty_body') {
    safeSend(
      reply, result.status, formatters.formatEmptyBodyErrorReply(result.status),
      formatters, `upstream returned ${result.status} with empty body`,
    );
    return;
  }

  if (result.errorType === 'no_stream_body') {
    safeSend(
      reply, result.status, formatters.formatNoStreamBodyErrorReply(result.status),
      formatters, `upstream returned ${result.status} with no stream body`,
    );
    return;
  }

  if (result.errorType === 'stream_error') {
    return;
  }

  if (isStream && result.success) {
    return;
  }

  // 非流式成功
  if (formatters.formatNonStreamSuccess) {
    const body = formatters.formatNonStreamSuccess(result);
    reply.status(result.status).send(body);
  } else {
    reply.status(result.status).send(result.responseBody);
  }
}
