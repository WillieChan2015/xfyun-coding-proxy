import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { statsEmitter, recordRequestStart, recordRequestComplete, sessionStats, dailyStats, ProtocolStats } from '../../src/stats';

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