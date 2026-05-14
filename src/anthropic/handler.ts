import { FastifyRequest, FastifyReply } from 'fastify';
import { config, DEFAULT_MODEL } from '../config';
import { upstreamRequest, cleanXfyunFields } from '../upstream';
import { ANTHROPIC_SSE_EVENTS } from './types';
import type { AnthropicUsage } from './types';
import type { UpstreamResult } from '../upstream';

/**
 * 从 Anthropic 响应中提取 token 用量
 * Anthropic 使用 input_tokens / output_tokens（非 OpenAI 的 prompt_tokens / completion_tokens）
 */
function extractAnthropicUsage(
  body: Record<string, unknown>,
): { promptTokens?: number; completionTokens?: number } {
  const usage = body.usage as AnthropicUsage | undefined;
  if (!usage) return {};
  if (usage.input_tokens > 0 || usage.output_tokens > 0) {
    return {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
    };
  }
  return {};
}

/**
 * 从 Anthropic SSE 流中提取 token 用量
 * 在 message_delta 事件中: {"type":"message_delta","usage":{"output_tokens":N}}
 * 在 message_start 事件中: {"type":"message_start","message":{"usage":{"input_tokens":N,"output_tokens":1}}}
 */
function extractAnthropicStreamUsage(
  rawChunk: string,
): { inputTokens?: number; outputTokens?: number } {
  // message_start 中的 input_tokens
  const inputMatch = rawChunk.match(/"input_tokens"\s*:\s*(\d+)/);
  // message_delta 中的 output_tokens（取最后一个非零值，因为是增量的）
  const outputMatches = [...rawChunk.matchAll(/"output_tokens"\s*:\s*(\d+)/g)];
  const lastOutput = outputMatches.length > 0
    ? parseInt(outputMatches[outputMatches.length - 1][1], 10)
    : undefined;

  if (inputMatch || lastOutput !== undefined) {
    return {
      inputTokens: inputMatch ? parseInt(inputMatch[1], 10) : undefined,
      outputTokens: lastOutput,
    };
  }
  return {};
}

/**
 * Anthropic 协议 POST /anthropic/v1/messages 路由 handler
 *
 * 流程：
 * 1. 覆盖 model 为 astron-code-latest
 * 2. 构建上游请求（认证头替换 + model 覆盖）
 * 3. 带重试地转发请求
 * 4. 根据流式/非流式分别处理响应
 *    - 非流式：清理讯飞特有字段后返回
 *    - 流式：Anthropic SSE 事件过滤 + 讯飞字段清理 → 实时透传
 */
export async function handleAnthropicMessages(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as Record<string, unknown> | undefined;

  const isStream = body?.stream === true || body?.stream === 'true';
  if (body && typeof body.stream === 'string') {
    body.stream = body.stream === 'true';
  }

  // 覆盖 model
  const model = DEFAULT_MODEL;
  if (body) {
    body.model = model;
  }

  const ua = request.headers['user-agent'] ?? 'unknown';
  request.log.info(
    `anthropic request | ${request.url} | stream=${isStream} | model=${model} | ua=${ua}`,
  );

  // ---- 构建上游请求 ----
  const upstreamUrl = `${config.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`;

  // Anthropic 认证头：x-api-key + anthropic-version
  // 透传客户端的 anthropic-beta 头（如有）
  const ALLOWED_UPSTREAM_HEADERS = new Set([
    'x-request-id',
    'x-correlation-id',
    'anthropic-beta',
  ]);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  };

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
    protocol: 'anthropic',
    upstreamUrl,
    headers,
    body,
    isStream,
    allowedSSEEvents: ANTHROPIC_SSE_EVENTS,
    extractStreamUsage: extractAnthropicStreamUsage,
    extractNonStreamUsage: extractAnthropicUsage,
    cleanNonStreamBody: (responseBody: Record<string, unknown>) => {
      const cleanedBody = cleanXfyunFields(JSON.stringify(responseBody));
      return JSON.parse(cleanedBody) as Record<string, unknown>;
    },
    formatNetworkError: (errMsg: string) => ({
      status: 502,
      body: {
        type: 'error',
        error: {
          type: 'api_error',
          message: `upstream request failed: ${errMsg}`,
        },
      },
    }),
    formatUpstreamError: (status: number, responseBodyText: string) => ({
      status,
      body: responseBodyText,
    }),
    formatEmptyBodyError: (status: number) => ({
      status,
      body: {
        type: 'error',
        error: {
          type: 'api_error',
          message: `upstream returned ${status} with empty body`,
        },
      },
    }),
    formatNoStreamBodyError: (status: number) => ({
      status,
      body: {
        type: 'error',
        error: {
          type: 'api_error',
          message: `upstream returned ${status} with no stream body`,
        },
      },
    }),
    formatStreamErrorEvent: (errMsg: string) =>
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `stream interrupted: ${errMsg}`,
        },
      })}\n\n`,
    request: { id: request.id, url: request.url, headers: request.headers, log: request.log },
    rawReply: { write: (data) => reply.raw.write(data), end: () => reply.raw.end() },
  });

  // Handle result based on errorType
  if (result.errorType === 'network') {
    reply.status(502).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: `upstream request failed: ${result.error}`,
      },
    });
    return;
  }

  if (result.errorType === 'upstream') {
    reply.status(result.status).send(result.errorBody);
    return;
  }

  if (result.errorType === 'empty_body') {
    const status = result.status === 502 ? 500 : result.status;
    reply.status(status).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: `upstream returned ${result.status} with empty body`,
      },
    });
    return;
  }

  if (result.errorType === 'no_stream_body') {
    reply.status(result.status).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: `upstream returned ${result.status} with no stream body`,
      },
    });
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