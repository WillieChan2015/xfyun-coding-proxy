import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import {
  upstreamRequest,
  extractStreamUsage,
  buildUpstreamUrl,
} from '../upstream';
import type { UpstreamResult } from '../upstream';
import { recordRequestComplete, requestStarted, requestFinished } from '../stats';
import { convertChatRequest, convertGenerateRequest } from './request';
import {
  convertChatResponse,
  convertGenerateResponse,
  convertTagsResponse,
  convertErrorToOllama,
  SSEToNDJSONConverter,
} from './response';
import type { OllamaChatRequest, OllamaGenerateRequest, OllamaEndpoint } from './types';

/**
 * Ollama 协议 POST /ollama/api/chat 路由 handler
 * 将 Ollama /api/chat 请求转换为 OpenAI 格式后转发到讯飞上游
 */
export async function handleOllamaChat(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await handleOllamaProxy(request, reply, 'chat');
}

/**
 * Ollama 协议 POST /ollama/api/generate 路由 handler
 * 将 Ollama /api/generate 请求（prompt → messages）转换为 OpenAI 格式后转发
 */
export async function handleOllamaGenerate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await handleOllamaProxy(request, reply, 'generate');
}

/**
 * Ollama 协议 GET /ollama/api/tags 路由 handler
 * 请求上游 /v1/models 并将 OpenAI 格式转换为 Ollama /api/tags 格式
 */
export async function handleOllamaTags(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  requestStarted();
  const ua = request.headers['user-agent'] ?? 'unknown';
  const upstreamUrl = buildUpstreamUrl('/v1/models');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };

  try {
    const startTime = Date.now();
    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    const body = await response.text();
    const latencyMs = Date.now() - startTime;
    request.log.info(`ollama tags | ${response.status}`);

    if (!response.ok) {
      reply.status(response.status).send({ error: body });
      recordRequestComplete({
        protocol: 'ollama',
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        success: false,
        requestId: request.id,
        path: request.url,
        ua,
        retries: 0,
        error: `upstream ${response.status}`,
      });
      requestFinished();
      return;
    }

    const openai = JSON.parse(body) as Record<string, unknown>;
    const ollamaTags = convertTagsResponse(openai);

    reply.status(200).send(ollamaTags);
    recordRequestComplete({
      protocol: 'ollama',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      success: true,
      requestId: request.id,
      path: request.url,
      ua,
      retries: 0,
    });
    requestFinished();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    request.log.error(`ollama tags error | ${msg}`);
    recordRequestComplete({
      protocol: 'ollama',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      success: false,
      requestId: request.id,
      path: request.url,
      ua,
      retries: 0,
      error: msg,
    });
    reply.status(500).send({ error: msg });
    requestFinished();
  }
}

/** 流式错误时通过 raw.write 写入的 NDJSON 错误行格式 */
function formatOllamaStreamErrorEvent(errMsg: string): string {
  return JSON.stringify({ error: `stream interrupted: ${errMsg}` }) + '\n';
}

/**
 * Ollama 协议 POST 代理统一处理函数
 *
 * 通过 upstreamRequest() 统一处理请求转发、重试、SSE 过滤和统计，
 * 仅在协议转换层（请求转换 + 响应转换）做 Ollama 特有逻辑：
 * 1. 请求转换：Ollama 格式 → OpenAI 格式（options 提升、format 映射、model 覆盖）
 * 2. 响应转换：
 *    - 非流式：清理讯飞特有字段后转换为 Ollama JSON 格式
 *    - 流式：通过 streamTransform 回调将 SSE → NDJSON 实时转换输出
 */
async function handleOllamaProxy(
  request: FastifyRequest,
  reply: FastifyReply,
  endpoint: OllamaEndpoint,
): Promise<void> {
  const rawBody = request.body as Record<string, unknown>;

  // ---- 步骤 1：请求转换 Ollama → OpenAI ----
  let openaiBody: Record<string, unknown>;
  if (endpoint === 'chat') {
    openaiBody = convertChatRequest(rawBody as unknown as OllamaChatRequest);
  } else {
    openaiBody = convertGenerateRequest(rawBody as unknown as OllamaGenerateRequest);
  }

  const isStream = openaiBody.stream === true;

  const ua = request.headers['user-agent'] ?? 'unknown';
  request.log.info(
    `ollama ${endpoint} | stream=${isStream} | model=${rawBody.model ?? 'unknown'} | ua=${ua}`,
  );

  // ---- 步骤 2：构建上游请求 ----
  const upstreamUrl = buildUpstreamUrl('/v1/chat/completions');

  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };

  // 流式请求：提前写入 NDJSON 响应头
  if (isStream) {
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }

  // ---- 步骤 3：通过 upstreamRequest 统一转发 ----
  const ndjsonConverter = new SSEToNDJSONConverter(endpoint);

  const result: UpstreamResult = await upstreamRequest({
    protocol: 'ollama',
    upstreamUrl,
    headers: upstreamHeaders,
    body: openaiBody,
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
    streamTransform: isStream
      ? (cleanedChunk: string) => ndjsonConverter.convert(cleanedChunk)
      : undefined,
    formatStreamErrorEvent: formatOllamaStreamErrorEvent,
    request: { id: request.id, url: request.url, headers: request.headers, log: request.log },
    rawReply: { write: (data) => reply.raw.write(data), end: () => reply.raw.end() },
  });

  // ---- 步骤 4：处理结果 ----

  // 网络错误
  if (result.errorType === 'network') {
    if (reply.raw.headersSent) {
      reply.raw.write(formatOllamaStreamErrorEvent(`upstream request failed: ${result.error}`));
      reply.raw.end();
    } else {
      reply.status(502).send({ error: `upstream request failed: ${result.error}` });
    }
    return;
  }

  // 上游返回非 2xx 错误
  if (result.errorType === 'upstream') {
    if (reply.raw.headersSent) {
      reply.raw.write(formatOllamaStreamErrorEvent(`upstream returned ${result.status}`));
      reply.raw.end();
    } else {
      try {
        const errJson = JSON.parse(result.errorBody ?? '') as Record<string, unknown>;
        reply.status(result.status).send(convertErrorToOllama(errJson));
      } catch {
        reply.status(result.status).send({ error: (result.errorBody ?? '').slice(0, 200) });
      }
    }
    return;
  }

  // 空响应体
  if (result.errorType === 'empty_body') {
    if (reply.raw.headersSent) {
      reply.raw.write(formatOllamaStreamErrorEvent(`upstream returned ${result.status} with empty body`));
      reply.raw.end();
    } else {
      reply.status(result.status).send({ error: `upstream returned ${result.status} with empty body` });
    }
    return;
  }

  // 流式请求上游无 body
  if (result.errorType === 'no_stream_body') {
    if (reply.raw.headersSent) {
      reply.raw.write(formatOllamaStreamErrorEvent(`upstream returned ${result.status} with no stream body`));
      reply.raw.end();
    } else {
      reply.status(result.status).send({ error: `upstream returned ${result.status} with no stream body` });
    }
    return;
  }

  // 流式错误已在 upstreamRequest 内通过 rawReply.write 写入
  if (result.errorType === 'stream_error') {
    return;
  }

  // 流式成功 — 已由 upstreamRequest + streamTransform 处理
  if (isStream && result.success) {
    return;
  }

  // 非流式成功：将 OpenAI 响应转换为 Ollama 格式
  if (result.responseBody) {
    const ollamaResponse =
      endpoint === 'chat'
        ? convertChatResponse(result.responseBody)
        : convertGenerateResponse(result.responseBody);
    reply.status(result.status).send(ollamaResponse);
    return;
  }

  // 兜底：不应到达此处
  reply.status(500).send({ error: 'unexpected response state' });
}
