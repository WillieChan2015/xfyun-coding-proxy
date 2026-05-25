import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { statsEmitter, recordRequestStart, recordRequestComplete, sessionStats, dailyStats, getRequestLog } from '../../src/stats';

// 保存/恢复 sessionStats 和 dailyStats，避免跨测试污染
let savedSessionStats: typeof sessionStats;
let savedDailyStats: typeof dailyStats;

beforeEach(() => {
  savedSessionStats = { ...sessionStats, protocols: { ...sessionStats.protocols } };
  savedDailyStats = { ...dailyStats, protocols: { ...dailyStats.protocols } };
});

afterEach(() => {
  Object.assign(sessionStats, savedSessionStats);
  sessionStats.protocols = savedSessionStats.protocols;
  Object.assign(dailyStats, savedDailyStats);
  dailyStats.protocols = savedDailyStats.protocols;
});

describe('stats events', () => {
  it('emits request:start event', () => {
    const events: unknown[] = [];
    const listener = (data: unknown) => events.push(data);
    statsEmitter.on('request:start', listener);
    recordRequestStart('openai', 'astron-code-latest');
    statsEmitter.off('request:start', listener);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ protocol: 'openai', model: 'astron-code-latest' });
  });

  it('emits request:complete event', () => {
    const events: unknown[] = [];
    const listener = (data: unknown) => events.push(data);
    statsEmitter.on('request:complete', listener);
    recordRequestComplete({
      protocol: 'openai',
      model: 'astron-code-latest',
      inputTokens: 100,
      outputTokens: 200,
      latencyMs: 1500,
      success: true,
      retries: 0,
    });
    statsEmitter.off('request:complete', listener);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      protocol: 'openai',
      model: 'astron-code-latest',
      inputTokens: 100,
      outputTokens: 200,
      latencyMs: 1500,
      success: true,
      retries: 0,
    });
  });

  it('recordRequestComplete updates sessionStats and dailyStats', () => {
    const prevSessionReq = sessionStats.requestCount;
    const prevDailyReq = dailyStats.requestCount;
    recordRequestComplete({
      protocol: 'anthropic',
      model: 'astron-code-latest',
      inputTokens: 50,
      outputTokens: 100,
      latencyMs: 800,
      success: true,
      retries: 1,
    });
    expect(sessionStats.requestCount).toBe(prevSessionReq + 1);
    expect(dailyStats.requestCount).toBe(prevDailyReq + 1);
    expect(sessionStats.totalPromptTokens).toBeGreaterThanOrEqual(50);
  });

  it('recordRequestComplete counts errors', () => {
    const prevErrors = sessionStats.errors;
    recordRequestComplete({
      protocol: 'openai',
      model: 'astron-code-latest',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 5000,
      success: false,
      retries: 2,
      error: 'upstream error',
    });
    expect(sessionStats.errors).toBe(prevErrors + 1);
  });

  it('recordRequestComplete updates protocol stats', () => {
    const prevOllamaReq = (sessionStats.protocols.ollama?.requestCount ?? 0);
    recordRequestComplete({
      protocol: 'ollama',
      model: 'astron-code-latest',
      inputTokens: 30,
      outputTokens: 60,
      latencyMs: 300,
      success: true,
      retries: 0,
    });
    expect(sessionStats.protocols.ollama.requestCount).toBe(prevOllamaReq + 1);
    expect(sessionStats.protocols.ollama.totalPromptTokens).toBeGreaterThanOrEqual(30);
  });

  it('recordRequestComplete with error updates protocol error count', () => {
    const prevAnthropicErrors = (sessionStats.protocols.anthropic?.errors ?? 0);
    recordRequestComplete({
      protocol: 'anthropic',
      model: 'astron-code-latest',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 1000,
      success: false,
      retries: 1,
      error: 'timeout',
    });
    expect(sessionStats.protocols.anthropic.errors).toBe(prevAnthropicErrors + 1);
  });
});

describe('request log pending → complete in-place update', () => {
  it('updates pending entry in-place when requestId matches', () => {
    const reqId = `test-${Date.now()}-1`;
    recordRequestStart('openai', 'test-model', reqId, '/v1/chat', 'test-ua', true);
    const afterStart = getRequestLog();
    const pendingEntry = afterStart.find((e) => e.requestId === reqId);
    expect(pendingEntry).toBeDefined();
    expect(pendingEntry!.pending).toBe(true);

    recordRequestComplete({
      protocol: 'openai',
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 200,
      latencyMs: 1500,
      success: true,
      retries: 0,
      stream: true,
      requestId: reqId,
      path: '/v1/chat',
      ua: 'test-ua',
    });

    const afterComplete = getRequestLog();
    const matchingEntries = afterComplete.filter((e) => e.requestId === reqId);
    expect(matchingEntries.length).toBe(1);
    expect(matchingEntries[0].pending).toBe(false);
    expect(matchingEntries[0].inputTokens).toBe(100);
    expect(matchingEntries[0].outputTokens).toBe(200);
    expect(matchingEntries[0].latencyMs).toBe(1500);
    expect(matchingEntries[0].success).toBe(true);
  });

  it('preserves path, protocol, model from pending entry after update', () => {
    const reqId = `test-${Date.now()}-2`;
    recordRequestStart('anthropic', 'claude-3', reqId, '/anthropic/v1/messages', 'ua-x');

    recordRequestComplete({
      protocol: 'anthropic',
      model: 'claude-3',
      inputTokens: 50,
      outputTokens: 80,
      latencyMs: 600,
      success: true,
      retries: 0,
      requestId: reqId,
      path: '/anthropic/v1/messages',
      ua: 'ua-x',
    });

    const log = getRequestLog();
    const entry = log.find((e) => e.requestId === reqId);
    expect(entry).toBeDefined();
    expect(entry!.path).toBe('/anthropic/v1/messages');
    expect(entry!.protocol).toBe('anthropic');
    expect(entry!.model).toBe('claude-3');
    expect(entry!.method).toBe('POST');
  });

  it('pushes new entry when no requestId is provided (no pending to update)', () => {
    const beforeLen = getRequestLog().length;
    recordRequestComplete({
      protocol: 'ollama',
      model: 'llama3',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 200,
      success: true,
      retries: 0,
    });
    const after = getRequestLog();
    expect(after.length).toBe(Math.min(beforeLen + 1, 100));
    const last = after[after.length - 1];
    expect(last.protocol).toBe('ollama');
    expect(last.pending).toBeUndefined();
  });

  it('pushes new entry when requestId has no matching pending entry', () => {
    const beforeLen = getRequestLog().length;
    recordRequestComplete({
      protocol: 'openai',
      model: 'test',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 100,
      success: false,
      retries: 0,
      requestId: 'nonexistent-id',
      error: 'upstream error',
    });
    const after = getRequestLog();
    expect(after.length).toBe(Math.min(beforeLen + 1, 100));
    const last = after[after.length - 1];
    expect(last.requestId).toBe('nonexistent-id');
    expect(last.pending).toBeUndefined();
  });

  it('sets pending=false and success=false on failed request', () => {
    const reqId = `test-${Date.now()}-3`;
    recordRequestStart('openai', 'test-model', reqId);

    recordRequestComplete({
      protocol: 'openai',
      model: 'test-model',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 5000,
      success: false,
      retries: 2,
      requestId: reqId,
      error: 'timeout',
    });

    const log = getRequestLog();
    const entry = log.find((e) => e.requestId === reqId);
    expect(entry).toBeDefined();
    expect(entry!.pending).toBe(false);
    expect(entry!.success).toBe(false);
    expect(entry!.error).toBe('timeout');
  });
});
