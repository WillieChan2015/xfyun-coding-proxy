import { FastifyRequest, FastifyReply } from 'fastify';
import { config, resolveModelId } from '../config';
import {
  upstreamRequest,
  extractStreamUsage,
  buildUpstreamUrl,
  cleanXfyunFieldsObj,
  handleUpstreamResult,
} from '../upstream';
import type { UpstreamResult } from '../upstream';
import { isDebugEnabled, debugLogRequest } from '../debug-logger';
import { convertChatRequest, convertGenerateRequest } from './request';
import {
  convertChatResponse,
  convertGenerateResponse,
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

  // 在请求转换之前解析模型 ID
  const model = resolveModelId(rawBody.model as string | undefined, request.log);

  // ---- 步骤 1：请求转换 Ollama → OpenAI ----
  let openaiBody: Record<string, unknown>;
  if (endpoint === 'chat') {
    openaiBody = convertChatRequest(rawBody as unknown as OllamaChatRequest, model);
  } else {
    openaiBody = convertGenerateRequest(rawBody as unknown as OllamaGenerateRequest, model);
  }

  const isStream = openaiBody.stream === true;

  const ua = request.headers['user-agent'] ?? 'unknown';
  request.log.info(
    `ollama ${endpoint} | stream=${isStream} | model=${model} (requested: ${rawBody.model ?? 'unknown'}) | ua=${ua}`,
  );

  if (isDebugEnabled()) {
    debugLogRequest(request.id, {
      method: request.method,
      url: request.url,
      headers: request.headers as Record<string, string | undefined>,
      body: rawBody,
    });
  }

  // ---- 步骤 2：构建上游请求 ----
  const upstreamUrl = buildUpstreamUrl('/v1/chat/completions');

  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };

  // 流式响应头延迟写入：不再提前 writeHead(200)，
  // 由 upstreamRequest 在确认上游 2xx 且有 body 后调用 rawReply.writeHeader
  // ---- 步骤 3：通过 upstreamRequest 统一转发 ----
  const ndjsonConverter = new SSEToNDJSONConverter(endpoint, model);

  const result: UpstreamResult = await upstreamRequest({
    protocol: 'ollama',
    model,
    upstreamUrl,
    headers: upstreamHeaders,
    body: openaiBody,
    isStream,
    streamHeaders: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
    extractStreamUsage: (rawChunk: string) => {
      const usage = extractStreamUsage(rawChunk);
      if (usage.promptTokens !== undefined) {
        return { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens, cachedTokens: usage.cachedTokens };
      }
      if (usage.totalTokens !== undefined) {
        return { inputTokens: usage.totalTokens, outputTokens: 0, cachedTokens: usage.cachedTokens };
      }
      return {};
    },
    cleanNonStreamBody: (responseBody: Record<string, unknown>) => {
      cleanXfyunFieldsObj(responseBody);
      return responseBody;
    },
    streamTransform: isStream
      ? (cleanedChunk: string) => ndjsonConverter.convert(cleanedChunk)
      : undefined,
    formatStreamErrorEvent: formatOllamaStreamErrorEvent,
    request: { id: request.id, url: request.url, headers: request.headers, log: request.log },
    rawReply: {
      write: (data) => reply.raw.write(data),
      end: () => reply.raw.end(),
      writeHeader: (statusCode, hdrs) => reply.raw.writeHead(statusCode, hdrs),
    },
  });

  // ---- 步骤 4：处理结果 ----

  // 使用通用结果处理函数
  handleUpstreamResult(result, isStream, reply, {
    formatStreamErrorEvent: formatOllamaStreamErrorEvent,
    formatNetworkErrorReply: (errMsg) => ({ error: `upstream request failed: ${errMsg}` }),
    formatUpstreamErrorReply: (_status, errorBody) => {
      try {
        const errJson = JSON.parse(errorBody ?? '') as Record<string, unknown>;
        return convertErrorToOllama(errJson);
      } catch {
        return { error: (errorBody ?? '').slice(0, 200) };
      }
    },
    formatEmptyBodyErrorReply: (status) => ({ error: `upstream returned ${status} with empty body` }),
    formatNoStreamBodyErrorReply: (status) => ({ error: `upstream returned ${status} with no stream body` }),
    formatNonStreamSuccess: (result) => {
      if (result.responseBody) {
        return endpoint === 'chat'
          ? convertChatResponse(result.responseBody, model)
          : convertGenerateResponse(result.responseBody, model);
      }
      return result.responseBody;
    },
  });
}
