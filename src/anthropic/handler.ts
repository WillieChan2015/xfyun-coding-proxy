import { FastifyRequest, FastifyReply } from 'fastify';
import { config, DEFAULT_MODEL } from '../config';
import {
  fetchWithRetry,
  SSEFilter,
  cleanXfyunFields,
  isRetryableXfyunError,
  extractXfyunError,
} from '../proxy';
import { sessionStats, dailyStats } from '../stats';
import { ANTHROPIC_SSE_EVENTS } from './types';
import type { AnthropicUsage } from './types';

/**
 * 从 Anthropic 响应中提取 token 用量
 * Anthropic 使用 input_tokens / output_tokens（非 OpenAI 的 prompt_tokens / completion_tokens）
 */
function extractAnthropicUsage(
  body: Record<string, unknown>,
): { inputTokens?: number; outputTokens?: number } {
  const usage = body.usage as AnthropicUsage | undefined;
  if (!usage) return {};
  if (usage.input_tokens > 0 || usage.output_tokens > 0) {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
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
 * 格式化 token 数量为可读字符串
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M(${n})`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k(${n})`;
  return String(n);
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
  const startTime = Date.now();
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

  request.log.info(
    `anthropic request | ${request.url} | stream=${isStream} | model=${model}`,
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

  // ---- 带重试地转发请求 ----
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

  // ---- 处理响应 ----

  // 非流式请求的上游错误：直接透传错误响应
  if (!response.ok && !isStream && responseBodyText) {
    const xfyunErr = extractXfyunError(responseBodyText);
    const errDetail = xfyunErr ? ` | xfyun_code=${xfyunErr.code} msg=${xfyunErr.msg}` : '';
    request.log.error(
      `anthropic upstream error | ${response.status} | ${durationMs}ms | retries=${retries}${errDetail}`,
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.retries += retries;
    dailyStats.errors++;

    reply.status(response.status);
    reply.send(responseBodyText);
    return;
  }

  // 非流式请求上游错误但 body 为空
  if (!response.ok && !isStream && !responseBodyText) {
    request.log.error(
      `anthropic upstream error with empty body | ${response.status} | ${durationMs}ms | retries=${retries}`,
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.retries += retries;
    dailyStats.errors++;

    reply.status(response.status).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: `upstream returned ${response.status} with empty body`,
      },
    });
    return;
  }

  // 流式请求上游返回非 2xx 且无 body
  if (isStream && !response.ok && !response.body) {
    request.log.error(
      `anthropic stream upstream error with no body | ${response.status} | ${durationMs}ms | retries=${retries}`,
    );

    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.retries += retries;
    dailyStats.errors++;

    reply.status(response.status).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: `upstream returned ${response.status} with no stream body`,
      },
    });
    return;
  }

  // 流式请求：Anthropic SSE 事件过滤 + 讯飞字段清理 → 实时透传
  if (isStream && response.body) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = response.body.getReader();
    const sseFilter = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let streamError: string | null = null;

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
          streamError = errDetail;
          request.log.warn(
            `anthropic xfyun retryable error in stream (cannot retry, headers already sent) | ${errDetail}`,
          );
          break;
        }

        if (!isRetryableXfyunError(rawChunk) && rawChunk.includes('"error"')) {
          const xfyunErr = extractXfyunError(rawChunk);
          if (xfyunErr) {
            streamError = `code=${xfyunErr.code} msg=${xfyunErr.msg}`;
            request.log.warn(`anthropic upstream error in stream | ${streamError}`);
            break;
          }
        }

        const usage = extractAnthropicStreamUsage(rawChunk);
        if (usage.inputTokens !== undefined) {
          inputTokens = usage.inputTokens;
        }
        if (usage.outputTokens !== undefined) {
          outputTokens = usage.outputTokens;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamError = errMsg;
      request.log.error(`anthropic stream error | ${durationMs}ms | ${errMsg}`);

      const sseError = `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `stream interrupted: ${errMsg}`,
        },
      })}\n\n`;
      reply.raw.write(sseError);
    } finally {
      reader.releaseLock();
      reply.raw.end();
    }

    if (streamError) {
      request.log.error(`anthropic stream aborted | ${durationMs}ms | ${streamError}`);
      sessionStats.requestCount++;
      sessionStats.errors++;
      dailyStats.requestCount++;
      dailyStats.errors++;
      sessionStats.retries += retries;
      dailyStats.retries += retries;
      return;
    }

    const tokenInfo =
      inputTokens !== undefined
        ? `in=${fmtTokens(inputTokens)} out=${fmtTokens(outputTokens ?? 0)} total=${fmtTokens(inputTokens + (outputTokens ?? 0))}`
        : '';
    request.log.info(
      `anthropic stream completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
    );
    sessionStats.requestCount++;
    sessionStats.totalPromptTokens += inputTokens ?? 0;
    sessionStats.totalCompletionTokens += outputTokens ?? 0;
    sessionStats.retries += retries;
    dailyStats.requestCount++;
    dailyStats.totalPromptTokens += inputTokens ?? 0;
    dailyStats.totalCompletionTokens += outputTokens ?? 0;
    dailyStats.retries += retries;
    return;
  }

  // 非流式请求的正常响应：解析 JSON，清理讯飞特有字段后返回
  if (!responseBodyText) {
    request.log.error(
      `anthropic non-stream response with null body | ${response.status} | ${durationMs}ms | retries=${retries}`,
    );
    reply.status(500).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'upstream returned empty response body',
      },
    });
    sessionStats.requestCount++;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.errors++;
    return;
  }

  const responseBody = JSON.parse(responseBodyText) as Record<string, unknown>;

  // 清理讯飞特有字段
  const cleanedBody = cleanXfyunFields(JSON.stringify(responseBody));
  const finalBody = JSON.parse(cleanedBody) as Record<string, unknown>;

  const usageInfo = extractAnthropicUsage(finalBody);

  const tokenInfo =
    usageInfo.inputTokens !== undefined
      ? `in=${fmtTokens(usageInfo.inputTokens!)} out=${fmtTokens(usageInfo.outputTokens!)} total=${fmtTokens(usageInfo.inputTokens! + (usageInfo.outputTokens ?? 0))}`
      : '';
  request.log.info(
    `anthropic request completed | ${durationMs}ms | ${tokenInfo}`.replace(/ \| $/, ''),
  );

  sessionStats.requestCount++;
  sessionStats.totalPromptTokens += usageInfo.inputTokens ?? 0;
  sessionStats.totalCompletionTokens += usageInfo.outputTokens ?? 0;
  sessionStats.retries += retries;
  if (!response.ok) sessionStats.errors++;
  dailyStats.requestCount++;
  dailyStats.totalPromptTokens += usageInfo.inputTokens ?? 0;
  dailyStats.totalCompletionTokens += usageInfo.outputTokens ?? 0;
  dailyStats.retries += retries;
  if (!response.ok) dailyStats.errors++;

  reply.status(response.status);
  reply.send(finalBody);
}
