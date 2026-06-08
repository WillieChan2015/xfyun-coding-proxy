import { FastifyRequest, FastifyReply } from 'fastify';
import { config, resolveModelId } from '../config';
import { upstreamRequest, cleanXfyunFieldsObj, summarizeRequestDiagnostics, handleUpstreamResult } from '../upstream';
import { formatAnthropicError } from '../errors';
import { extractUpstreamHeaders } from '../util';
import { isDebugEnabled, debugLogRequest } from '../debug-logger';
import { ANTHROPIC_SSE_EVENTS } from './types';
import { extractSystemMessages } from './system-extract';
import type { AnthropicUsage } from './types';
import type { UpstreamResult, RequestDiagnostics } from '../upstream';

const ALLOWED_UPSTREAM_HEADERS = ['x-request-id', 'x-correlation-id', 'anthropic-beta'];

/** 流式错误时通过 raw.write 写入的 Anthropic SSE 错误事件格式 */
function formatStreamErrorEvent(errMsg: string): string {
  return `event: error\ndata: ${JSON.stringify({
    type: 'error',
    error: {
      type: 'api_error',
      message: `stream interrupted: ${errMsg}`,
    },
  })}\n\n`;
}

/** 安全解析上游错误体，确保返回 Anthropic 格式的错误响应 */
function safeParseAnthropicError(errorBody: string, fallbackStatus: number): { status: number; body: unknown } {
  try {
    const parsed = JSON.parse(errorBody);
    // 已经是 Anthropic 错误格式 { type: "error", error: { type, message } }
    if (parsed?.type === 'error' && parsed?.error?.message) {
      return { status: fallbackStatus, body: parsed };
    }
    // 讯飞格式 { code, msg, sid } → 转换为 Anthropic 格式
    if (parsed?.code !== undefined && parsed?.msg !== undefined) {
      return {
        status: fallbackStatus,
        body: formatAnthropicError('api_error', `[code:${parsed.code}] ${parsed.msg}`),
      };
    }
    return { status: fallbackStatus, body: formatAnthropicError('api_error', errorBody) };
  } catch {
    return { status: fallbackStatus, body: formatAnthropicError('api_error', errorBody) };
  }
}

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
 * 1. 解析 model ID（resolveModelId：白名单校验 + 环境变量开关）
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
  const model = resolveModelId(body?.model as string | undefined, request.log);
  if (body) {
    body.model = model;
  }

  // Claude Code 2.1.156+ 启用 mid-conversation-system beta 后，
  // 会在 messages 中插入 role: "system" 的消息，讯飞 API 不支持此格式。
  // 默认开启（XFYUN_MID_CONVERSATION_SYSTEM=false 可关闭），自动提取到 system 字段
  if (config.midConversationSystem && body) {
    extractSystemMessages(body);
  }

  const ua = request.headers['user-agent'] ?? 'unknown';
  request.log.info(
    `anthropic request | ${request.url} | stream=${isStream} | model=${model} | ua=${ua}`,
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
  const upstreamUrl = `${config.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`;

  // Anthropic 认证头：x-api-key + anthropic-version
  // 透传客户端的 anthropic-beta 头（如有）

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    ...extractUpstreamHeaders(request.headers, ALLOWED_UPSTREAM_HEADERS),
  };

  // 流式响应头延迟写入：不再提前 writeHead(200)，
  // 由 upstreamRequest 在确认上游 2xx 且有 body 后调用 rawReply.writeHeader
  const result: UpstreamResult = await upstreamRequest({
    protocol: 'anthropic',
    model,
    upstreamUrl,
    headers,
    body,
    isStream,
    allowedSSEEvents: ANTHROPIC_SSE_EVENTS,
    extractStreamUsage: extractAnthropicStreamUsage,
    extractNonStreamUsage: extractAnthropicUsage,
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
    formatNetworkErrorReply: (errMsg) => formatAnthropicError('api_error', `upstream request failed: ${errMsg}`),
    formatUpstreamErrorReply: (status, errorBody) => {
      // 上游返回非 2xx，errorBody 可能是讯飞格式而非 Anthropic 格式，
      // 统一包装为 Anthropic 错误格式
      const parsed = safeParseAnthropicError(errorBody ?? '', status);
      return parsed.body;
    },
    formatEmptyBodyErrorReply: (status) => formatAnthropicError('api_error', `upstream returned ${status} with empty body`),
    formatNoStreamBodyErrorReply: (status) => formatAnthropicError('api_error', `upstream returned ${status} with no stream body`),
  });
}