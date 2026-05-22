import { describe, it, expect } from 'bun:test';
import { parseSSELine, cleanXfyunFields, cleanXfyunFieldsObj } from '../../src/upstream';

describe('parseSSELine', () => {
  it('parses data: with space', () => {
    expect(parseSSELine('data: {"content":"hello"}')).toEqual({
      field: 'data',
      value: '{"content":"hello"}',
    });
  });

  it('parses data: without space (SSE spec allows both)', () => {
    expect(parseSSELine('data:{"content":"hello"}')).toEqual({
      field: 'data',
      value: '{"content":"hello"}',
    });
  });

  it('parses event: with space', () => {
    expect(parseSSELine('event: message')).toEqual({
      field: 'event',
      value: 'message',
    });
  });

  it('parses event: without space', () => {
    expect(parseSSELine('event:message')).toEqual({
      field: 'event',
      value: 'message',
    });
  });

  it('parses id: field', () => {
    expect(parseSSELine('id: 12345')).toEqual({
      field: 'id',
      value: '12345',
    });
  });

  it('parses retry: field', () => {
    expect(parseSSELine('retry: 5000')).toEqual({
      field: 'retry',
      value: '5000',
    });
  });

  it('handles empty value after colon', () => {
    expect(parseSSELine('data:')).toEqual({
      field: 'data',
      value: '',
    });
  });

  it('handles empty value after colon+space', () => {
    expect(parseSSELine('data: ')).toEqual({
      field: 'data',
      value: '',
    });
  });

  it('returns null for line without colon', () => {
    expect(parseSSELine('no colon here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSSELine('')).toBeNull();
  });

  it('handles multiple colons in value', () => {
    expect(parseSSELine('data: {"time":"12:30:45"}')).toEqual({
      field: 'data',
      value: '{"time":"12:30:45"}',
    });
  });
});

describe('cleanXfyunFields', () => {
  it('removes reasoning_content from SSE data line', () => {
    const input = 'data: {"role":"assistant","content":"hi","reasoning_content":""}\n\n';
    const result = cleanXfyunFields(input);
    expect(result).toBe('data: {"role":"assistant","content":"hi"}\n\n');
  });

  it('removes plugins_content from SSE data line', () => {
    const input = 'data: {"role":"assistant","content":"hi","plugins_content":null}\n\n';
    const result = cleanXfyunFields(input);
    expect(result).toBe('data: {"role":"assistant","content":"hi"}\n\n');
  });

  it('handles data: without space (SSE spec)', () => {
    const input = 'data:{"role":"assistant","content":"hi","reasoning_content":""}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('data: {"role":"assistant","content":"hi"}');
  });

  it('preserves [DONE] marker', () => {
    const input = 'data: [DONE]\n\n';
    const result = cleanXfyunFields(input);
    expect(result).toBe(input);
  });

  it('handles reasoning_content with escaped quotes', () => {
    const input = '{"role":"assistant","content":"hi","reasoning_content":"say \\"hello\\""}';
    const result = cleanXfyunFields(input);
    expect(result).toBe('{"role":"assistant","content":"hi"}');
  });

  it('returns input unchanged when no xfyun fields present', () => {
    const input = 'data: {"role":"assistant","content":"hello"}\n\n';
    expect(cleanXfyunFields(input)).toBe(input);
  });

  it('handles empty input', () => {
    expect(cleanXfyunFields('')).toBe('');
  });
});

describe('cleanXfyunFieldsObj', () => {
  it('removes top-level reasoning_content', () => {
    const obj = { role: 'assistant', content: 'hi', reasoning_content: '' };
    const modified = cleanXfyunFieldsObj(obj);
    expect(modified).toBe(true);
    expect(obj).toEqual({ role: 'assistant', content: 'hi' });
  });

  it('removes top-level plugins_content', () => {
    const obj = { role: 'assistant', content: 'hi', plugins_content: null };
    const modified = cleanXfyunFieldsObj(obj);
    expect(modified).toBe(true);
    expect(obj).toEqual({ role: 'assistant', content: 'hi' });
  });

  it('removes reasoning_content from choices[].delta', () => {
    const obj = {
      choices: [{ delta: { content: 'hi', reasoning_content: 'think...' } }],
    };
    const modified = cleanXfyunFieldsObj(obj);
    expect(modified).toBe(true);
    expect(obj.choices[0].delta).toEqual({ content: 'hi' });
  });

  it('removes reasoning_content from choices[].message', () => {
    const obj = {
      choices: [{ message: { content: 'hi', reasoning_content: 'think...' } }],
    };
    const modified = cleanXfyunFieldsObj(obj);
    expect(modified).toBe(true);
    expect(obj.choices[0].message).toEqual({ content: 'hi' });
  });

  it('returns false when no xfyun fields present', () => {
    const obj = { role: 'assistant', content: 'hello' };
    expect(cleanXfyunFieldsObj(obj)).toBe(false);
    expect(obj).toEqual({ role: 'assistant', content: 'hello' });
  });
});
