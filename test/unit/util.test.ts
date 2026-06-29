import { describe, it, expect } from 'bun:test';
import { extractTokenUsage, estimateInputTokens } from '../../src/util';

describe('extractTokenUsage', () => {
  it('extracts token counts from usage object', () => {
    const result = extractTokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(result).toEqual({ promptTokens: 10, completionTokens: 5, cachedTokens: undefined });
  });

  it('extracts cached_tokens from prompt_tokens_details', () => {
    const result = extractTokenUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 80 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    });
    expect(result).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: 80 });
  });

  it('handles cached_tokens as 0 (no cache hit)', () => {
    const result = extractTokenUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });
    // cached_tokens: 0 等同于无缓存命中，不记录
    expect(result).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: undefined });
  });

  it('returns cachedTokens as undefined when prompt_tokens_details is missing', () => {
    const result = extractTokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(result).toEqual({ promptTokens: 10, completionTokens: 5, cachedTokens: undefined });
  });

  it('ignores cached_tokens when value is 0 or negative', () => {
    // 0: 无缓存命中
    const r1 = extractTokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } },
    });
    expect(r1.cachedTokens).toBeUndefined();
    // 负数：异常数据，不应记录
    const r2 = extractTokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: -1 } },
    });
    expect(r2.cachedTokens).toBeUndefined();
  });

  it('returns empty object when usage is missing', () => {
    const result = extractTokenUsage({});
    expect(result).toEqual({});
  });

  it('returns undefined for non-number token values', () => {
    const result = extractTokenUsage({
      usage: { prompt_tokens: '10', completion_tokens: 5 },
    });
    expect(result).toEqual({ promptTokens: undefined, completionTokens: 5 });
  });

  it('returns partial result when only one token type present', () => {
    const result = extractTokenUsage({
      usage: { prompt_tokens: 10 },
    });
    expect(result).toEqual({ promptTokens: 10, completionTokens: undefined });
  });
});

describe('estimateInputTokens', () => {
  it('estimates from string messages', () => {
    const result = estimateInputTokens({
      messages: [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am fine, thank you!' },
      ],
    });
    // "Hello, how are you?" (20) + "I am fine, thank you!" (20) = 40 chars → ceil(40/4) = 10
    expect(result).toBe(10);
  });

  it('estimates from content block messages', () => {
    const result = estimateInputTokens({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    });
    // "Hello world" = 11 chars → ceil(11/4) = 3
    expect(result).toBe(3);
  });

  it('includes system string', () => {
    const result = estimateInputTokens({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    // "You are helpful" (16) + "Hi" (2) = 18 chars → ceil(18/4) = 5
    expect(result).toBe(5);
  });

  it('includes system content blocks', () => {
    const result = estimateInputTokens({
      system: [{ type: 'text', text: 'Be concise' }],
      messages: [{ role: 'user', content: 'Hi' }],
    });
    // "Be concise" (10) + "Hi" (2) = 12 chars → ceil(12/4) = 3
    expect(result).toBe(3);
  });

  it('includes tool names and descriptions', () => {
    const result = estimateInputTokens({
      messages: [],
      tools: [
        { name: 'get_weather', description: 'Get weather for a city' },
      ],
    });
    // "get_weather" (11) + "Get weather for a city" (23) = 34 chars → ceil(34/4) = 9
    expect(result).toBe(9);
  });

  it('handles tool_result with nested content blocks', () => {
    const result = estimateInputTokens({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', content: [{ type: 'text', text: 'Sunny, 25C' }] },
          ],
        },
      ],
    });
    // "Sunny, 25C" (10) → ceil(10/4) = 3
    expect(result).toBe(3);
  });

  it('returns 0 for empty body', () => {
    expect(estimateInputTokens({})).toBe(0);
    expect(estimateInputTokens({ messages: [] })).toBe(0);
  });
});
