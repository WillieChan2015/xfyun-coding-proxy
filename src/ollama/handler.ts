import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import { readWithTimeout } from '../util';
import {
  fetchWithRetry,
  SSEFilter,
  cleanXfyunFields,
  isRetryableXfyunError,
  extractXfyunError,
  buildUpstreamUrl,
  extractStreamUsage,
} from '../proxy';
import { extractTokenUsage, fmtTokens } from '../util';
import { sessionStats, dailyStats, incrementProtocolStats, rolloverDailyStats } from '../stats';
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
  const upstreamUrl = buildUpstreamUrl('/v1/models');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };

  try {
    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    const body = await response.text();
    request.log.info(`ollama tags | ${response.status}`);

    if (!response.ok) {
      sessionStats.requestCount++;
      sessionStats.errors++;
      dailyStats.requestCount++;
      dailyStats.errors++;
      incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1, errors: 1 });
      incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1, errors: 1 });
      reply.status(response.status).send({ error: body });
      return;
    }

    const openai = JSON.parse(body) as Record<string, unknown>;
    const ollamaTags = convertTagsResponse(openai);

    sessionStats.requestCount++;
    dailyStats.requestCount++;
    incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1 });
    incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1 });

    reply.status(200).send(ollamaTags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    request.log.error(`ollama tags error | ${msg}`);
    sessionStats.requestCount++;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.errors++;
    incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1, errors: 1 });
    incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1, errors: 1 });
    reply.status(500).send({ error: msg });
  }
}

/**
 * Ollama 协议 POST 代理统一处理函数
 *
 * 流程：
 * 1. 请求转换：Ollama 格式 → OpenAI 格式（options 提升、format 映射、model 覆盖）
 * 2. 构建上游请求（API Key 注入 + 路径重写）
 * 3. 带重试地转发请求
 * 4. 根据流式/非流式分别处理响应
 *    - 非流式：清理讯飞特有字段后转换为 Ollama JSON 格式
 *    - 流式：SSE 过滤 + 讯飞字段清理 → NDJSON 实时转换输出
 */
async function handleOllamaProxy(
  request: FastifyRequest,
  reply: FastifyReply,
  endpoint: OllamaEndpoint,
): Promise<void> {
  rolloverDailyStats(config.logDir);
  const startTime = Date.now();
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

  // ---- 步骤 3：带重试地转发请求 ----
  let response: Awaited<ReturnType<typeof fetchWithRetry>>['response'];
  let responseBodyText: string | null;
  let retries: number;

  try {
    const result = await fetchWithRetry(
      upstreamUrl,
      {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(openaiBody),
      },
      config.maxRetries,
      config.retryDelay,
      !isStream,
      request.log,
    );
    response = result.response;
    responseBodyText = result.body;
    retries = result.retries;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    request.log.error(`ollama upstream fetch error | ${Date.now() - startTime}ms | ${errMsg}`);

    sessionStats.requestCount++;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.errors++;
    incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1, errors: 1 });
    incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1, errors: 1 });

    reply.status(502).send({ error: `upstream request failed: ${errMsg}` });
    return;
  }

  const durationMs = Date.now() - startTime;

  // ---- 步骤 4：处理响应 ----

  // 4a. 非流式请求的上游错误：转换为 Ollama 错误格式返回
  if (!response.ok && !isStream && responseBodyText) {
    request.log.error(`ollama upstream error | ${response.status} | ${durationMs}ms`);
    sessionStats.requestCount++;
    sessionStats.retries += retries;
    sessionStats.errors++;
    dailyStats.requestCount++;
    dailyStats.retries += retries;
    dailyStats.errors++;
    incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1, retries, errors: 1 });
    incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1, retries, errors: 1 });

    try {
      const errJson = JSON.parse(responseBodyText) as Record<string, unknown>;
      reply.status(response.status).send(convertErrorToOllama(errJson));
    } catch {
      reply.status(response.status).send({ error: responseBodyText.slice(0, 200) });
    }
    return;
  }

  // 4b. 非流式请求的正常响应：清理讯飞字段后转换为 Ollama 格式
  if (!isStream && responseBodyText) {
    try {
      const openai = JSON.parse(responseBodyText) as Record<string, unknown>;

      const choices = openai.choices as Array<Record<string, unknown>> | undefined;
      if (choices) {
        for (const choice of choices) {
          const message = choice.message as Record<string, unknown> | undefined;
          if (message) {
            delete message.plugins_content;
            delete message.reasoning_content;
          }
        }
      }

      const ollamaResponse =
        endpoint === 'chat'
          ? convertChatResponse(openai)
          : convertGenerateResponse(openai);

      const usage = openai.usage as Record<string, unknown> | undefined;
      const usageInfo = extractTokenUsage(usage || {});
      const tokenInfo =
        usageInfo.promptTokens !== undefined
          ? `in=${fmtTokens(usageInfo.promptTokens!)} out=${fmtTokens(usageInfo.completionTokens!)}`
          : '';

      request.log.info(`ollama ${endpoint} completed | ${durationMs}ms | ${tokenInfo}`);
      sessionStats.requestCount++;
      sessionStats.totalPromptTokens += usageInfo.promptTokens ?? 0;
      sessionStats.totalCompletionTokens += usageInfo.completionTokens ?? 0;
      sessionStats.retries += retries;
      dailyStats.requestCount++;
      dailyStats.totalPromptTokens += usageInfo.promptTokens ?? 0;
      dailyStats.totalCompletionTokens += usageInfo.completionTokens ?? 0;
      dailyStats.retries += retries;
      incrementProtocolStats(sessionStats, 'ollama', {
        requestCount: 1,
        totalPromptTokens: usageInfo.promptTokens ?? 0,
        totalCompletionTokens: usageInfo.completionTokens ?? 0,
        retries,
      });
      incrementProtocolStats(dailyStats, 'ollama', {
        requestCount: 1,
        totalPromptTokens: usageInfo.promptTokens ?? 0,
        totalCompletionTokens: usageInfo.completionTokens ?? 0,
        retries,
      });

      reply.status(200).send(ollamaResponse);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error(`ollama response parse error | ${msg}`);
      sessionStats.requestCount++;
      sessionStats.errors++;
      dailyStats.requestCount++;
      dailyStats.errors++;
      incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1, errors: 1 });
      incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1, errors: 1 });
      reply.status(500).send({ error: `response parse error: ${msg}` });
    }
    return;
  }

  // 4c. 流式请求：SSE 过滤 + 讯飞字段清理 → NDJSON 实时转换
  if (isStream && response.body) {
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = response.body.getReader();
    const sseFilter = new SSEFilter();
    const ndjsonConverter = new SSEToNDJSONConverter(endpoint);
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let streamError: string | null = null;

    try {
      while (true) {
        const { done, value } = await readWithTimeout(reader, config.streamReadTimeout);
        if (done) break;

        const rawChunk = Buffer.from(value).toString('utf-8');

        const filtered = sseFilter.filter(rawChunk, request.log);
        const cleaned = cleanXfyunFields(filtered);

        const ndjsonLines = ndjsonConverter.convert(cleaned);
        for (const line of ndjsonLines) {
          reply.raw.write(line + '\n');
        }

        if (isRetryableXfyunError(rawChunk)) {
          const xfyunErr = extractXfyunError(rawChunk);
          streamError = xfyunErr
            ? `code=${xfyunErr.code} msg=${xfyunErr.msg}`
            : 'unknown';
          request.log.warn(`ollama xfyun error in stream | ${streamError}`);
          break;
        }

        const usage = extractStreamUsage(rawChunk);
        if (usage.promptTokens !== undefined) {
          promptTokens = usage.promptTokens;
          completionTokens = usage.completionTokens;
        } else if (usage.totalTokens !== undefined) {
          promptTokens = usage.totalTokens;
          completionTokens = 0;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamError = errMsg;
      request.log.error(`ollama stream error | ${errMsg}`);
      const errorLine = JSON.stringify({ error: `stream interrupted: ${errMsg}` }) + '\n';
      reply.raw.write(errorLine);
    } finally {
      reader.releaseLock();
      reply.raw.end();
    }

    if (streamError) {
      sessionStats.requestCount++;
      sessionStats.errors++;
      dailyStats.requestCount++;
      dailyStats.errors++;
      incrementProtocolStats(sessionStats, 'ollama', { requestCount: 1, errors: 1 });
      incrementProtocolStats(dailyStats, 'ollama', { requestCount: 1, errors: 1 });
    } else {
      const tokenInfo =
        promptTokens !== undefined
          ? `in=${fmtTokens(promptTokens)} out=${fmtTokens(completionTokens!)}`
          : '';
      request.log.info(`ollama ${endpoint} stream completed | ${durationMs}ms | ${tokenInfo}`);
    }

    sessionStats.retries += retries;
    dailyStats.retries += retries;
    incrementProtocolStats(sessionStats, 'ollama', { retries });
    incrementProtocolStats(dailyStats, 'ollama', { retries });
    return;
  }

  reply.status(500).send({ error: 'unexpected response state' });
}
