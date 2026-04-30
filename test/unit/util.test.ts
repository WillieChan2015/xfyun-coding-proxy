import { describe, it, expect } from 'bun:test';
import { extractTokenUsage } from '../../src/util';

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
