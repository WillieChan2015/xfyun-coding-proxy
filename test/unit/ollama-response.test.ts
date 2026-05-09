import { describe, it, expect } from 'bun:test';
import {
  convertChatResponse,
  convertGenerateResponse,
  convertTagsResponse,
  convertErrorToOllama,
  SSEToNDJSONConverter,
} from '../../src/ollama/response';

describe('convertChatResponse', () => {
  it('converts OpenAI chat completion to Ollama /api/chat response', () => {
    const openai = {
      id: 'chatcmpl-123',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 100, total_tokens: 120 },
    };
    const result = convertChatResponse(openai);
    expect(result.model).toBe('astron-code-latest');
    expect(result.message).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(result.done).toBe(true);
    expect(result.done_reason).toBe('stop');
    expect(result.prompt_eval_count).toBe(20);
    expect(result.eval_count).toBe(100);
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('handles missing usage gracefully', () => {
    const openai = {
      id: 'chatcmpl-123',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hi' },
        finish_reason: 'stop',
      }],
    };
    const result = convertChatResponse(openai);
    expect(result.prompt_eval_count).toBeUndefined();
    expect(result.eval_count).toBeUndefined();
  });

  it('maps finish_reason values', () => {
    const base = (reason: string) => ({
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: reason }],
    });
    expect(convertChatResponse(base('stop')).done_reason).toBe('stop');
    expect(convertChatResponse(base('length')).done_reason).toBe('length');
    expect(convertChatResponse(base('tool_calls')).done_reason).toBe('tool_calls');
  });
});

describe('convertGenerateResponse', () => {
  it('converts OpenAI chat completion to Ollama /api/generate response', () => {
    const openai = {
      id: 'chatcmpl-123',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'The sky is blue.' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
    };
    const result = convertGenerateResponse(openai);
    expect(result.model).toBe('astron-code-latest');
    expect(result.response).toBe('The sky is blue.');
    expect(result.done).toBe(true);
    expect(result.done_reason).toBe('stop');
    expect(result.prompt_eval_count).toBe(10);
    expect(result.eval_count).toBe(50);
  });
});

describe('convertTagsResponse', () => {
  it('converts OpenAI /v1/models to Ollama /api/tags', () => {
    const openai = {
      object: 'list',
      data: [
        { id: 'astron-code-latest', object: 'model', created: 1677652288, owned_by: 'xfyun' },
      ],
    };
    const result = convertTagsResponse(openai);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe('astron-code-latest');
    expect(result.models[0].model).toBe('astron-code-latest');
    expect(result.models[0].details.format).toBe('gguf');
  });

  it('handles empty model list', () => {
    const openai = { object: 'list', data: [] };
    const result = convertTagsResponse(openai);
    expect(result.models).toHaveLength(0);
  });
});

describe('convertErrorToOllama', () => {
  it('converts OpenAI error object to Ollama error string', () => {
    const openai = { error: { message: 'model not found', type: 'invalid_request', code: 404 } };
    expect(convertErrorToOllama(openai)).toEqual({ error: 'model not found' });
  });

  it('handles error without message', () => {
    const openai = { error: { type: 'server_error', code: 500 } };
    expect(convertErrorToOllama(openai)).toEqual({ error: 'Unknown error' });
  });
});

describe('SSEToNDJSONConverter', () => {
  it('converts SSE data line to NDJSON chat chunk', () => {
    const converter = new SSEToNDJSONConverter('chat');
    const sseLine = 'data: {"choices":[{"delta":{"content":"Hel"},"index":0}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"content":"Hel"');
    expect(result[0]).toContain('"done":false');
  });

  it('converts finish_reason to done:true chunk', () => {
    const converter = new SSEToNDJSONConverter('chat');
    const sseLine = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"done":true');
    expect(result[0]).toContain('"done_reason":"stop"');
  });

  it('outputs content + done when both arrive together', () => {
    const converter = new SSEToNDJSONConverter('chat');
    const sseLine = 'data: {"choices":[{"delta":{"content":"bye"},"finish_reason":"stop"}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('"content":"bye"');
    expect(result[0]).toContain('"done":false');
    expect(result[1]).toContain('"done":true');
  });

  it('skips data: [DONE]', () => {
    const converter = new SSEToNDJSONConverter('chat');
    const sseLine = 'data: [DONE]\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(0);
  });

  it('uses response field for generate endpoint', () => {
    const converter = new SSEToNDJSONConverter('generate');
    const sseLine = 'data: {"choices":[{"delta":{"content":"Hel"},"index":0}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"response":"Hel"');
    expect(result[0]).not.toContain('"message"');
  });

  it('extracts usage from final chunk', () => {
    const converter = new SSEToNDJSONConverter('chat');
    const sseLine = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":100}}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"prompt_eval_count":20');
    expect(result[0]).toContain('"eval_count":100');
  });

  it('handles empty input', () => {
    const converter = new SSEToNDJSONConverter('chat');
    const result = converter.convert('');
    expect(result).toHaveLength(0);
  });
});
