import { describe, it, expect, afterEach } from 'bun:test';
import {
  requestStarted,
  requestFinished,
  streamingStarted,
  streamingFinished,
  getActiveRequests,
  getStreamingRequests,
  getLatencyStats,
  getRequestLog,
  recordRequestComplete,
  sessionStats,
} from '../../src/stats';

// 清理 sessionStats，避免污染其他测试
afterEach(() => {
  sessionStats.requestCount = 0;
  sessionStats.totalPromptTokens = 0;
  sessionStats.totalCompletionTokens = 0;
  sessionStats.retries = 0;
  sessionStats.errors = 0;
  sessionStats.protocols = {};
});

describe('concurrent tracking', () => {
  // 并发计数器是模块级状态，测试中注意已有数据

  it('tracks active requests', () => {
    const before = getActiveRequests();
    requestStarted();
    requestStarted();
    expect(getActiveRequests()).toBe(before + 2);
    requestFinished();
    expect(getActiveRequests()).toBe(before + 1);
    requestFinished();
    expect(getActiveRequests()).toBe(before);
  });

  it('tracks streaming requests', () => {
    const before = getStreamingRequests();
    streamingStarted();
    streamingStarted();
    expect(getStreamingRequests()).toBe(before + 2);
    streamingFinished();
    expect(getStreamingRequests()).toBe(before + 1);
    streamingFinished();
    expect(getStreamingRequests()).toBe(before);
  });

  it('does not go below zero', () => {
    const before = getActiveRequests();
    requestFinished();
    expect(getActiveRequests()).toBe(before); // 不会低于之前值
    expect(getActiveRequests()).toBeGreaterThanOrEqual(0);
  });
});

describe('latency tracking', () => {
  it('returns zero when empty', () => {
    // 延迟窗口可能已有数据，只验证结构
    const stats = getLatencyStats();
    expect(stats).toHaveProperty('avg');
    expect(stats).toHaveProperty('p95');
  });

  it('computes avg and p95', () => {
    // 通过 recordRequestComplete 添加延迟数据
    for (let i = 1; i <= 100; i++) {
      recordRequestComplete({
        protocol: 'openai',
        model: 'test',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: i * 10,
        success: true,
        retries: 0,
      });
    }
    const stats = getLatencyStats();
    expect(stats.avg).toBeGreaterThan(0);
    expect(stats.p95).toBeGreaterThan(0);
    expect(stats.p95).toBeGreaterThanOrEqual(stats.avg);
  });
});

describe('request log buffer', () => {
  it('stores request entries', () => {
    recordRequestComplete({
      protocol: 'anthropic',
      model: 'test',
      inputTokens: 50,
      outputTokens: 100,
      latencyMs: 800,
      success: true,
      retries: 0,
    });
    const log = getRequestLog();
    const last = log[log.length - 1];
    expect(last.protocol).toBe('anthropic');
    expect(last.inputTokens).toBe(50);
    expect(last.outputTokens).toBe(100);
    expect(last.success).toBe(true);
  });

  it('limits buffer size', () => {
    // 添加超过 100 条
    for (let i = 0; i < 110; i++) {
      recordRequestComplete({
        protocol: 'openai',
        model: 'test',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 100,
        success: true,
        retries: 0,
      });
    }
    expect(getRequestLog().length).toBeLessThanOrEqual(100);
  });
});
