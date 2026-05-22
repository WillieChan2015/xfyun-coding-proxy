import { describe, it, expect } from 'bun:test';
import { cleanXfyunFields } from '../../src/upstream';

describe('cleanXfyunFields', () => {
  it('removes trailing reasoning_content', () => {
    const input = '{"role":"assistant","content":"hi","reasoning_content":""}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });

  it('removes leading reasoning_content', () => {
    const input = '{"reasoning_content":"","role":"assistant","content":"hi"}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });

  it('removes plugins_content', () => {
    const input = '{"role":"assistant","content":"hi","plugins_content":null}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });

  it('removes both reasoning_content and plugins_content', () => {
    const input =
      '{"role":"assistant","content":"hi","reasoning_content":"","plugins_content":null}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });

  it('removes reasoning_content with non-empty value', () => {
    const input = '{"role":"assistant","content":"hi","reasoning_content":"thinking..."}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });

  it('preserves strings without xfyun fields', () => {
    const input = '{"role":"assistant","content":"hello"}';
    const result = cleanXfyunFields(input);
    expect(result).toBe(input);
  });

  it('handles empty input', () => {
    expect(cleanXfyunFields('')).toBe('');
  });

  it('handles reasoning_content with escaped quotes', () => {
    // JSON.parse 方式可以正确处理含转义引号的 reasoning_content 值
    const input = '{"role":"assistant","content":"hi","reasoning_content":"say \\"hello\\""}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });
});
