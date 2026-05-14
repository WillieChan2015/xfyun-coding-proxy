import { FastifyRequest, FastifyReply } from 'fastify';
import { formatOpenAIError } from './errors';
import { config, DEFAULT_MODEL } from './config';
import { recordRequestComplete, requestStarted, requestFinished, Protocol } from './stats';
import {
  upstreamRequest,
  extractStreamUsage,
  buildUpstreamUrl,
  summarizeContentTypes,
  summarizeRequestDiagnostics,
} from './upstream';
import type { UpstreamResult } from './upstream';
import type { RequestDiagnostics } from './upstream';

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

  if (isStream) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }

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
      return responseBody;
    },
    formatStreamErrorEvent: (errMsg: string) =>
      `data: ${JSON.stringify({
        error: {
          message: `stream interrupted: ${errMsg}`,
          type: 'upstream_error',
          code: 500,
        },
      })}\n\ndata: [DONE]\n\n`,
    request: { id: request.id, url: request.url, headers: request.headers, log: request.log },
    rawReply: { write: (data) => reply.raw.write(data), end: () => reply.raw.end() },
    diagnostics: diag,
  });

  // Handle result based on errorType
  if (result.errorType === 'network') {
    reply.status(502).send(formatOpenAIError(502, `upstream request failed: ${result.error}`));
    return;
  }

  if (result.errorType === 'upstream') {
    reply.status(result.status).send(result.errorBody);
    return;
  }

  if (result.errorType === 'empty_body') {
    reply.status(result.status).send(formatOpenAIError(result.status, `upstream returned ${result.status} with empty body`));
    return;
  }

  if (result.errorType === 'no_stream_body') {
    reply.status(result.status).send(formatOpenAIError(result.status, `upstream returned ${result.status} with no stream body`));
    return;
  }

  // Stream errors are already handled by rawReply.write in upstreamRequest
  if (result.errorType === 'stream_error') {
    return;
  }

  // Stream success — already handled by rawReply in upstreamRequest
  if (isStream && result.success) {
    return;
  }

  // Non-stream success
  reply.status(result.status).send(result.responseBody);
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
  // 根据请求路径前缀判断协议归属：/ollama/ 开头的请求归入 ollama，其余归入 openai
  const protocol = request.url.startsWith('/ollama/') ? 'ollama' : 'openai';
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

  reply.status(response.status);
  reply.header('Content-Type', response.headers.get('content-type') || 'application/json');
  reply.send(body);
  recordRequestComplete({
    protocol: protocol as 'openai' | 'anthropic' | 'ollama',
    model: 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    success: true,
    requestId: request.id,
    path: request.url,
    ua,
    retries: 0,
  });
  requestFinished();
}