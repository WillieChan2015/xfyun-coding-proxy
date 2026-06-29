import { describe, it, expect } from 'bun:test';
import { extractAnthropicUsage, extractAnthropicStreamUsage } from '../../src/anthropic/handler';

describe('extractAnthropicUsage', () => {
  it('extracts cache_read_input_tokens as cachedTokens', () => {
    const result = extractAnthropicUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
      },
    });
    expect(result).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: 80 });
  });

  it('returns undefined cachedTokens when cache_read_input_tokens is 0', () => {
    const result = extractAnthropicUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
      },
    });
    expect(result).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: undefined });
  });

  it('returns undefined cachedTokens when cache_read_input_tokens absent', () => {
    const result = extractAnthropicUsage({
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(result).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: undefined });
  });

  it('returns empty object when usage absent', () => {
    expect(extractAnthropicUsage({})).toEqual({});
  });
});

describe('extractAnthropicStreamUsage', () => {
  it('extracts cache_read_input_tokens from message_start chunk', () => {
    const chunk = JSON.stringify({
      type: 'message_start',
      message: {
        usage: { input_tokens: 20489, output_tokens: 1, cache_read_input_tokens: 1200 },
      },
    });
    const result = extractAnthropicStreamUsage(chunk);
    expect(result).toEqual({
      inputTokens: 20489,
      outputTokens: 1,
      cachedTokens: 1200,
    });
  });

  it('keeps last non-zero cache_read_input_tokens across multiple chunks merged', () => {
    // 一个 rawChunk 可能含多个 SSE 事件，取最后一个非零值
    const chunk =
      '{"usage":{"cache_read_input_tokens":0}}\n' +
      '{"usage":{"cache_read_input_tokens":500}}\n';
    const result = extractAnthropicStreamUsage(chunk);
    expect(result.cachedTokens).toBe(500);
  });

  it('returns undefined cachedTokens when no cache hit', () => {
    const chunk = JSON.stringify({
      type: 'message_start',
      message: { usage: { input_tokens: 100, output_tokens: 1 } },
    });
    const result = extractAnthropicStreamUsage(chunk);
    expect(result.cachedTokens).toBeUndefined();
  });

  it('extracts output_tokens from message_delta', () => {
    const chunk = JSON.stringify({
      type: 'message_delta',
      usage: { output_tokens: 120 },
    });
    const result = extractAnthropicStreamUsage(chunk);
    expect(result.outputTokens).toBe(120);
  });

  it('returns empty object when no usage fields', () => {
    expect(extractAnthropicStreamUsage('{"type":"ping"}')).toEqual({});
  });
});
