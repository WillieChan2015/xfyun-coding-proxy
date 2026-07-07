import { describe, it, expect } from 'bun:test';
import {
  convertChatResponse,
  convertGenerateResponse,
  convertTagsResponse,
  convertErrorToOllama,
  buildShowResponse,
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
    const result = convertChatResponse(openai, 'xopdeepseekv4pro');
    expect(result.model).toBe('xopdeepseekv4pro');
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
    const result = convertChatResponse(openai, 'xsparkx2');
    expect(result.prompt_eval_count).toBeUndefined();
    expect(result.eval_count).toBeUndefined();
  });

  it('maps finish_reason values', () => {
    const base = (reason: string) => ({
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: reason }],
    });
    expect(convertChatResponse(base('stop'), 'xsparkx2').done_reason).toBe('stop');
    expect(convertChatResponse(base('length'), 'xsparkx2').done_reason).toBe('length');
    expect(convertChatResponse(base('tool_calls'), 'xsparkx2').done_reason).toBe('tool_calls');
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
    const result = convertGenerateResponse(openai, 'xopglm5');
    expect(result.model).toBe('xopglm5');
    expect(result.response).toBe('The sky is blue.');
    expect(result.done).toBe(true);
    expect(result.done_reason).toBe('stop');
    expect(result.prompt_eval_count).toBe(10);
    expect(result.eval_count).toBe(50);
  });
});

describe('convertTagsResponse', () => {
  it('generates model list from SUPPORTED_MODELS', () => {
    const result = convertTagsResponse();
    // 1 默认模型 + 17 具体模型 = 18
    expect(result.models).toHaveLength(18);
    // 首位是默认模型
    expect(result.models[0].name).toBe('astron-code-latest');
    expect(result.models[0].model).toBe('astron-code-latest');
    expect(result.models[0].details.format).toBe('gguf');
  });

  it('fills parameter_size with contextLength for supported models', () => {
    const result = convertTagsResponse();
    // 第二个模型（第一个具体模型）的 parameter_size 应为上下文长度
    const firstSupported = result.models[1];
    expect(firstSupported.details.parameter_size).toBeTruthy();
    expect(Number(firstSupported.details.parameter_size)).toBeGreaterThan(0);
  });

  it('adds thinking_levels for models that support thinking depth', () => {
    const result = convertTagsResponse();
    // xopdeepseekv4pro 和 xopdeepseekv4flash 应包含 thinking_levels
    const proModel = result.models.find(m => m.model === 'xopdeepseekv4pro');
    const flashModel = result.models.find(m => m.model === 'xopdeepseekv4flash');
    const nonThinkingModel = result.models.find(m => m.model === 'xsparkx2');

    expect(proModel).toBeDefined();
    expect(flashModel).toBeDefined();
    expect(nonThinkingModel).toBeDefined();

    expect(proModel!.details.thinking_levels).toEqual(['high', 'max']);
    expect(flashModel!.details.thinking_levels).toEqual(['high', 'max']);
    // 不支持思考深度的模型不应有此字段
    expect(nonThinkingModel!.details).not.toHaveProperty('thinking_levels');
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
    const converter = new SSEToNDJSONConverter('chat', 'xopdeepseekv4pro');
    const sseLine = 'data: {"choices":[{"delta":{"content":"Hel"},"index":0}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"content":"Hel"');
    expect(result[0]).toContain('"done":false');
    expect(result[0]).toContain('"model":"xopdeepseekv4pro"');
  });

  it('converts finish_reason to done:true chunk', () => {
    const converter = new SSEToNDJSONConverter('chat', 'xsparkx2');
    const sseLine = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"done":true');
    expect(result[0]).toContain('"done_reason":"stop"');
    expect(result[0]).toContain('"model":"xsparkx2"');
  });

  it('outputs content + done when both arrive together', () => {
    const converter = new SSEToNDJSONConverter('chat', 'xopglm5');
    const sseLine = 'data: {"choices":[{"delta":{"content":"bye"},"finish_reason":"stop"}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('"content":"bye"');
    expect(result[0]).toContain('"done":false');
    expect(result[1]).toContain('"done":true');
  });

  it('skips data: [DONE]', () => {
    const converter = new SSEToNDJSONConverter('chat', 'xopglm5');
    const sseLine = 'data: [DONE]\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(0);
  });

  it('uses response field for generate endpoint', () => {
    const converter = new SSEToNDJSONConverter('generate', 'xopdeepseekv4flash');
    const sseLine = 'data: {"choices":[{"delta":{"content":"Hel"},"index":0}]}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"response":"Hel"');
    expect(result[0]).not.toContain('"message"');
    expect(result[0]).toContain('"model":"xopdeepseekv4flash"');
  });

  it('extracts usage from final chunk', () => {
    const converter = new SSEToNDJSONConverter('chat', 'xopdeepseekv4flash');
    const sseLine = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":100}}\n\n';
    const result = converter.convert(sseLine);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('"prompt_eval_count":20');
    expect(result[0]).toContain('"eval_count":100');
  });

  it('handles empty input', () => {
    const converter = new SSEToNDJSONConverter('chat', 'xopkimik26');
    const result = converter.convert('');
    expect(result).toHaveLength(0);
  });
});

describe('buildShowResponse', () => {
  it('includes thinking in capabilities for models that support thinking depth', () => {
    const result = buildShowResponse('xopdeepseekv4pro');
    expect(result.capabilities).toContain('completion');
    expect(result.capabilities).toContain('tools');
    expect(result.capabilities).toContain('thinking');
  });

  it('does not include thinking in capabilities for models without thinking depth', () => {
    const result = buildShowResponse('xsparkx2');
    expect(result.capabilities).toContain('completion');
    expect(result.capabilities).toContain('tools');
    expect(result.capabilities).not.toContain('thinking');
  });

  it('includes thinking_levels in model_info for thinking models', () => {
    const result = buildShowResponse('xopdeepseekv4flash');
    expect(result.model_info['astron.thinking_levels']).toEqual(['high', 'max']);
  });

  it('does not include thinking_levels in model_info for non-thinking models', () => {
    const result = buildShowResponse('xsparkx2');
    expect(result.model_info).not.toHaveProperty('astron.thinking_levels');
  });
});
