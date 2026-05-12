import { describe, it, expect } from 'bun:test';
import { extractTokenUsage, estimateInputTokens } from '../../src/util';

describe('extractTokenUsage', () => {
  it('extracts token counts from usage object', () => {
    const result = extractTokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(result).toEqual({ promptTokens: 10, completionTokens: 5 });
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
