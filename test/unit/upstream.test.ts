import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { upstreamRequest, UpstreamOptions, UpstreamResult } from '../../src/upstream';
import { Protocol, sessionStats, resetDailyStats } from '../../src/stats';
import { config } from '../../src/config';

const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createMockRequest() {
  return {
    id: 'test-req-1',
    url: '/v1/chat/completions',
    headers: { 'user-agent': 'test-client' },
    log: mockLog,
  };
}

function createMockRawReply() {
  const state = { ended: false };
  const writtenChunks: string[] = [];
  return {
    writtenChunks,
    get ended() { return state.ended; },
    rawReply: {
      write: (data: string | Buffer) => {
        writtenChunks.push(String(data));
        return true;
      },
      end: () => {
        state.ended = true;
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
    isStream: overrides.isStream,
    formatNetworkError: (errMsg: string) => ({
      status: 502,
      body: { error: { message: errMsg, type: 'network_error', code: 502 } },
    }),
    formatUpstreamError: (status: number, body: string) => ({
      status,
      body: { error: { message: body, type: 'upstream_error', code: status } },
    }),
    formatEmptyBodyError: (status: number) => ({
      status,
      body: { error: { message: 'empty response body', type: 'empty_body_error', code: status } },
    }),
    formatNoStreamBodyError: (status: number) => ({
      status,
      body: { error: { message: 'no stream body', type: 'no_stream_body_error', code: status } },
    }),
    formatStreamErrorEvent: (errMsg: string) =>
      `event: error\ndata: {"error":{"message":"${errMsg}"}}\n\n`,
    request: createMockRequest(),
    rawReply: overrides.rawReply ?? mockRawReplyHelper.rawReply,
    ...overrides,
  };
}

let originalFetch: typeof globalThis.fetch;
let originalMaxRetries: number;
let originalRetryDelay: number;
let originalApiKey: string;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalMaxRetries = config.maxRetries;
  originalRetryDelay = config.retryDelay;
  originalApiKey = config.apiKey;
  config.maxRetries = 0;
  config.retryDelay = 0;
  config.apiKey = 'test-api-key';
  mockLog.debug.mockClear();
  mockLog.info.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.maxRetries = originalMaxRetries;
  config.retryDelay = originalRetryDelay;
  config.apiKey = originalApiKey;
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

    globalThis.fetch = vi.fn(() =>
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

    globalThis.fetch = vi.fn(() =>
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
    globalThis.fetch = vi.fn(() => {
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
    globalThis.fetch = vi.fn(() =>
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

    globalThis.fetch = vi.fn(() =>
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

    globalThis.fetch = vi.fn(() =>
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
  });
});