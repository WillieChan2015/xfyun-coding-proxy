import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { upstreamRequest, UpstreamOptions, UpstreamResult } from '../../src/upstream';
import { ANTHROPIC_SSE_EVENTS } from '../../src/anthropic/types';
import { Protocol, sessionStats, resetDailyStats } from '../../src/stats';
import { config } from '../../src/config';

const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function mockFetch(fn: () => Promise<Response> | never): typeof globalThis.fetch {
  return vi.fn(fn) as unknown as typeof globalThis.fetch;
}

function createMockRequest() {
  return {
    id: 'test-req-1',
    url: '/v1/chat/completions',
    headers: { 'user-agent': 'test-client' },
    log: {
      debug: mockLog.debug,
      info: mockLog.info,
      warn: mockLog.warn,
      error: mockLog.error,
      fatal: mockLog.error,
      trace: mockLog.debug,
      silent: vi.fn(),
      child: () => createMockRequest().log,
      level: 'info',
    } as unknown as import('fastify').FastifyInstance['log'],
  };
}

function createMockRawReply() {
  const state = { ended: false, headersSent: false };
  const writtenChunks: string[] = [];
  const writtenHeaders: { statusCode: number; headers: Record<string, string> }[] = [];
  return {
    writtenChunks,
    writtenHeaders,
    get ended() { return state.ended; },
    get headersSent() { return state.headersSent; },
    rawReply: {
      write: (data: string | Buffer) => {
        writtenChunks.push(String(data));
        return true;
      },
      end: () => {
        state.ended = true;
      },
      writeHeader: (statusCode: number, headers: Record<string, string>) => {
        state.headersSent = true;
        writtenHeaders.push({ statusCode, headers });
      },
    },
  };
}

function createBaseOptions(
  overrides: Partial<UpstreamOptions> & { isStream: boolean },
): UpstreamOptions {
  const mockRawReplyHelper = createMockRawReply();
  return {
    protocol: 'openai' as Protocol,
    upstreamUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: { model: 'test-model', messages: [{ role: 'user', content: 'hello' }] },
    formatStreamErrorEvent: (errMsg: string) =>
      `event: error\ndata: {"error":{"message":"${errMsg}"}}\n\n`,
    request: createMockRequest(),
    rawReply: mockRawReplyHelper.rawReply,
    ...overrides,
  };
}

let originalFetch: typeof globalThis.fetch | undefined;
let originalMaxRetries: number;
let originalRetryDelay: number;
let originalApiKey: string;
let originalUpstreamFetchTimeout: number;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalMaxRetries = config.maxRetries;
  originalRetryDelay = config.retryDelay;
  originalApiKey = config.apiKey;
  originalUpstreamFetchTimeout = config.upstreamFetchTimeout;
  config.maxRetries = 0;
  config.retryDelay = 0;
  config.apiKey = 'test-api-key';
  config.upstreamFetchTimeout = 300_000;
  mockLog.debug.mockClear();
  mockLog.info.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch!;
  config.maxRetries = originalMaxRetries;
  config.retryDelay = originalRetryDelay;
  config.apiKey = originalApiKey;
  config.upstreamFetchTimeout = originalUpstreamFetchTimeout;
  sessionStats.protocols = {};
  resetDailyStats();
});

describe('upstreamRequest', () => {
  it('scenario 1: non-stream success response', async () => {
    const responseBody = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    globalThis.fetch = mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const options = createBaseOptions({ isStream: false });
    const result: UpstreamResult = await upstreamRequest(options);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.errorType).toBeUndefined();
    expect(result.responseBody).not.toBeNull();
    expect(result.responseBody!.id).toBe('chatcmpl-test');
    expect(result.responseBody!.choices).toBeDefined();
    expect(result.errorBody).toBeNull();
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('scenario 2: non-stream upstream error with body', async () => {
    const errorBody = {
      error: { message: 'Invalid request', type: 'invalid_request_error', code: 'invalid_api_key' },
    };

    globalThis.fetch = mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify(errorBody), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const options = createBaseOptions({ isStream: false });
    const result: UpstreamResult = await upstreamRequest(options);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('upstream');
    expect(result.status).toBe(400);
    expect(result.errorBody).toBe(JSON.stringify(errorBody));
    expect(result.responseBody).toBeNull();
  });

  it('scenario 3: network error', async () => {
    globalThis.fetch = mockFetch(() => {
      throw new Error('DNS resolution failed: getaddrinfo ENOTFOUND maas-coding-api');
    });

    const options = createBaseOptions({ isStream: false });
    const result: UpstreamResult = await upstreamRequest(options);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('network');
    expect(result.status).toBe(502);
    expect(result.responseBody).toBeNull();
    expect(result.errorBody).toBeNull();
    expect(result.error).toContain('DNS resolution failed');
  });

  it('scenario 4: non-stream empty body error', async () => {
    globalThis.fetch = mockFetch(() =>
      Promise.resolve(
        new Response('', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: {},
        }),
      ),
    );

    const options = createBaseOptions({ isStream: false });
    const result: UpstreamResult = await upstreamRequest(options);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('empty_body');
    expect(result.status).toBe(502);
    expect(result.responseBody).toBeNull();
    expect(result.errorBody).toBeNull();
  });

  it('scenario 5: stream success response', async () => {
    const sseData =
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"delta":{"content":" there"}}]}\n\n' +
      'data: [DONE]\n\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    globalThis.fetch = mockFetch(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const mockRawReplyHelper = createMockRawReply();
    const options = createBaseOptions({
      isStream: true,
      rawReply: mockRawReplyHelper.rawReply,
    });
    const result: UpstreamResult = await upstreamRequest(options);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.errorType).toBeUndefined();
    expect(mockRawReplyHelper.writtenChunks.length).toBeGreaterThan(0);
    expect(mockRawReplyHelper.ended).toBe(true);
  });

  it('scenario 6: stream error with xfyun error code in stream', async () => {
    const sseData =
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      'data: {"code":10012,"msg":"EngineInternalError:error","sid":"cht000b3fc4@dx19e0072f47eb958700"}\n\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    globalThis.fetch = mockFetch(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const mockRawReplyHelper = createMockRawReply();
    const options = createBaseOptions({
      isStream: true,
      rawReply: mockRawReplyHelper.rawReply,
    });
    const result: UpstreamResult = await upstreamRequest(options);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('stream_error');
    expect(result.status).toBe(200);
    expect(mockRawReplyHelper.ended).toBe(true);
    // 修复后：讯飞错误时应向客户端写入 error SSE 事件，而非空响应
    const fullResponse = mockRawReplyHelper.writtenChunks.join('');
    expect(fullResponse).toContain('event: error');
    expect(fullResponse).toContain('10012');
  });

  it('scenario 7: Anthropic SSE error event passes through to client', async () => {
    // 模拟 Anthropic 协议下讯飞通过 event: error 返回错误（如上下文超长）
    // 使用 ANTHROPIC_SSE_EVENTS（包含 error）确保 error 事件不被 SSEFilter 过滤
    const sseData =
      'event: error\n' +
      'data: {"error":{"message":"context length exceeded","type":"api_error"},"type":"error"}\n\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    globalThis.fetch = mockFetch(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const mockRawReplyHelper = createMockRawReply();
    const options = createBaseOptions({
      isStream: true,
      rawReply: mockRawReplyHelper.rawReply,
      allowedSSEEvents: ANTHROPIC_SSE_EVENTS,
    });
    const result: UpstreamResult = await upstreamRequest(options);

    // extractXfyunError 现可识别 {"error":{"message":...}} 格式（格式2），
    // 检测到上游错误后中断流并标记 stream_error；error 事件本身也已透传给客户端
    expect(result.success).toBe(false);
    expect(result.errorType).toBe('stream_error');
    const fullResponse = mockRawReplyHelper.writtenChunks.join('');
    expect(fullResponse).toContain('event: error');
    expect(fullResponse).toContain('context length exceeded');
  });
});
