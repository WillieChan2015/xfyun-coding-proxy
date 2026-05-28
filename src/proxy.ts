import { FastifyRequest, FastifyReply } from 'fastify';
import { formatOpenAIError } from './errors';
import { config, DEFAULT_MODEL } from './config';
import { recordRequestComplete, requestStarted, requestFinished, Protocol } from './stats';
import { readBodyWithLimit, extractUpstreamHeaders } from './util';
import { isChatCompletionRequest } from './types/openai';
import { isDebugEnabled, debugLogRequest } from './debug-logger';
import {
  upstreamRequest,
  extractStreamUsage,
  buildUpstreamUrl,
  summarizeContentTypes,
  summarizeRequestDiagnostics,
  cleanXfyunFieldsObj,
  fetchWithRetry,
  handleUpstreamResult,
} from './upstream';
import type { UpstreamResult } from './upstream';
import type { RequestDiagnostics } from './upstream';

const ALLOWED_UPSTREAM_HEADERS = ['x-request-id', 'x-correlation-id'];

/** 流式错误时通过 raw.write 写入的 SSE 错误事件格式 */
function formatStreamErrorEvent(errMsg: string): string {
  return `data: ${JSON.stringify({
    error: {
      message: `stream interrupted: ${errMsg}`,
      type: 'upstream_error',
      code: 500,
    },
  })}\n\ndata: [DONE]\n\n`;
}

/** 安全解析上游错误体，确保返回 OpenAI 格式的错误响应 */
function safeParseOpenAIError(errorBody: string, fallbackStatus: number): { status: number; body: unknown } {
  try {
    const parsed = JSON.parse(errorBody);
    // 已经是 OpenAI 错误格式 { error: { message, type, code } }
    if (parsed?.error?.message) {
      return { status: fallbackStatus, body: parsed };
    }
    // 讯飞格式 { code, msg, sid } → 转换为 OpenAI 格式
    if (parsed?.code !== undefined && parsed?.msg !== undefined) {
      return {
        status: fallbackStatus,
        body: formatOpenAIError(fallbackStatus, `[code:${parsed.code}] ${parsed.msg}`),
      };
    }
    // 其他未知格式
    return { status: fallbackStatus, body: formatOpenAIError(fallbackStatus, errorBody) };
  } catch {
    return { status: fallbackStatus, body: formatOpenAIError(fallbackStatus, errorBody) };
  }
}

// Re-exports from upstream.ts for backward compatibility with existing test imports
export {
  isRetryableXfyunError,
  extractXfyunError,
  extractStreamUsage,
  rewritePath,
  buildUpstreamUrl,
  ALLOWED_SSE_EVENTS,
  SSEFilter,
  filterSSEEvents,
  cleanXfyunFields,
  cleanXfyunFieldsObj,
  fetchWithRetry,
  RETRYABLE_STATUS_CODES,
  RETRYABLE_XFYUN_CODES,
  summarizeContentTypes,
} from './upstream';

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
  // 根据请求路径前缀判断协议归属：/ollama/ 开头的请求归入 ollama，其余归入 openai
  const protocol = request.url.startsWith('/ollama/') ? 'ollama' : 'openai';
  const body = request.body as Record<string, unknown> | undefined;

  // 使用类型守卫验证请求体
  if (body && !isChatCompletionRequest(body)) {
    request.log.warn('Request body does not match ChatCompletionRequest schema');
  }

  const isStream = body?.stream === true || body?.stream === 'true';
  if (body && typeof body.stream === 'string') {
    body.stream = body.stream === 'true';
  }

  const model = DEFAULT_MODEL;
  if (body) {
    body.model = model;
  }

  const ua = request.headers['user-agent'] ?? 'unknown';
  request.log.info(
    `request incoming | ${request.url} | stream=${isStream} | ${summarizeContentTypes(body)} | ua=${ua}`,
  );

  if (isDebugEnabled()) {
    debugLogRequest(request.id, {
      method: request.method,
      url: request.url,
      headers: request.headers as Record<string, string | undefined>,
      body,
    });
  }

  let diag: RequestDiagnostics | undefined;
  if (config.verbose) {
    diag = summarizeRequestDiagnostics(body, model, isStream);
    request.log.debug(`request diagnostics | ${JSON.stringify(diag)}`);
  }

  // ---- 构建上游请求 ----
  const upstreamUrl = buildUpstreamUrl(request.url);

  // 仅转发白名单 headers，其余丢弃
  // 原因：部分 IDE（如 Trae）会添加 destination-domain 等非标准 header，
  // 讯飞服务端会因 header 值不符合 RFC1035 而返回 400

  // 构建上游请求 headers：注入 API Key，替换客户端传入的 Authorization
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    ...extractUpstreamHeaders(request.headers, ALLOWED_UPSTREAM_HEADERS),
  };

  // 流式响应头延迟写入：不再提前 writeHead(200)，
  // 由 upstreamRequest 在确认上游 2xx 且有 body 后调用 rawReply.writeHeader
  const result: UpstreamResult = await upstreamRequest({
    protocol: protocol as Protocol,
    upstreamUrl,
    headers,
    body,
    isStream,
    extractStreamUsage: (rawChunk: string) => {
      const usage = extractStreamUsage(rawChunk);
      if (usage.promptTokens !== undefined) {
        return { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens };
      }
      if (usage.totalTokens !== undefined) {
        return { inputTokens: usage.totalTokens, outputTokens: 0 };
      }
      return {};
    },
    cleanNonStreamBody: (responseBody: Record<string, unknown>) => {
      cleanXfyunFieldsObj(responseBody);
      return responseBody;
    },
    formatStreamErrorEvent,
    request: { id: request.id, url: request.url, headers: request.headers, log: request.log },
    rawReply: {
      write: (data) => reply.raw.write(data),
      end: () => reply.raw.end(),
      writeHeader: (statusCode, hdrs) => reply.raw.writeHead(statusCode, hdrs),
    },
    diagnostics: diag,
  });

  // Handle result based on errorType
  // upstreamRequest 已延迟 writeHead，错误分支可直接用 reply.status().send()
  handleUpstreamResult(result, isStream, reply, {
    formatStreamErrorEvent,
    formatNetworkErrorReply: (errMsg) => formatOpenAIError(502, `upstream request failed: ${errMsg}`),
    formatUpstreamErrorReply: (status, errorBody) => {
      // 上游返回非 2xx，errorBody 可能是讯飞格式而非 OpenAI 格式，
      // 统一包装为 OpenAI 错误格式，确保 IDE 能正确解析
      const parsed = safeParseOpenAIError(errorBody ?? '', status);
      return parsed.body;
    },
    formatEmptyBodyErrorReply: (status) => formatOpenAIError(status, `upstream returned ${status} with empty body`),
    formatNoStreamBodyErrorReply: (status) => formatOpenAIError(status, `upstream returned ${status} with no stream body`),
  });
}

/**
 * GET 请求透传代理（如 /v1/models）
 * 不注入 body、不覆盖 model、不做 SSE 过滤，仅路径重写 + API Key 注入 + 透传响应
 */
export async function handleGetProxy(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  requestStarted();
  const ua = request.headers['user-agent'] ?? 'unknown';
  const protocol = request.url.startsWith('/ollama/') ? 'ollama' : 'openai';
  const upstreamUrl = buildUpstreamUrl(request.url);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };

  const startTime = Date.now();

  try {
    const { response, retries } = await fetchWithRetry(
      upstreamUrl,
      { method: 'GET', headers },
      config.maxRetries,
      config.retryDelay,
      true,
      request.log,
    );

    const body = await readBodyWithLimit(response);
    const latencyMs = Date.now() - startTime;

    request.log.info(`GET proxied | ${response.status} | ${request.url}`);

    reply.status(response.status);
    reply.header('Content-Type', response.headers.get('content-type') || 'application/json');
    reply.send(body);
    recordRequestComplete({
      protocol: protocol as 'openai' | 'anthropic' | 'ollama',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      success: true,
      stream: false,
      requestId: request.id,
      path: request.url,
      ua,
      retries,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const latencyMs = Date.now() - startTime;
    request.log.error(`GET proxy error | ${request.url} | ${errMsg}`);

    if (!reply.raw.headersSent) {
      reply.status(502).send(formatOpenAIError(502, `upstream request failed: ${errMsg}`));
    }
    recordRequestComplete({
      protocol: protocol as 'openai' | 'anthropic' | 'ollama',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      success: false,
      stream: false,
      requestId: request.id,
      path: request.url,
      ua,
      retries: 0,
      error: errMsg,
    });
  } finally {
    requestFinished();
  }
}