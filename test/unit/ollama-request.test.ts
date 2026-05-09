import { describe, it, expect } from 'bun:test';
import { convertChatRequest, convertGenerateRequest, mapFormat } from '../../src/ollama/request';

describe('convertChatRequest', () => {
  it('converts basic /api/chat request to OpenAI format', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.model).toBe('astron-code-latest');
    expect(result.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(result.stream).toBeUndefined();
  });

  it('preserves stream flag', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    });
    expect(result.stream).toBe(true);
  });

  it('lifts options.temperature to top level', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { temperature: 0.7 },
    });
    expect(result.temperature).toBe(0.7);
  });

  it('lifts options.top_p to top level', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { top_p: 0.9 },
    });
    expect(result.top_p).toBe(0.9);
  });

  it('maps options.num_predict to max_tokens', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { num_predict: 1024 },
    });
    expect(result.max_tokens).toBe(1024);
  });

  it('lifts options.seed to top level', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { seed: 42 },
    });
    expect(result.seed).toBe(42);
  });

  it('lifts options.stop to top level', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { stop: ['\n', 'END'] },
    });
    expect(result.stop).toEqual(['\n', 'END']);
  });

  it('lifts options.frequency_penalty to top level', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { frequency_penalty: 0.5 },
    });
    expect(result.frequency_penalty).toBe(0.5);
  });

  it('lifts options.presence_penalty to top level', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { presence_penalty: 0.3 },
    });
    expect(result.presence_penalty).toBe(0.3);
  });

  it('drops unsupported options (top_k, num_ctx, num_batch)', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      options: { top_k: 40, num_ctx: 2048, num_batch: 512 },
    });
    expect((result as Record<string, unknown>).top_k).toBeUndefined();
    expect((result as Record<string, unknown>).num_ctx).toBeUndefined();
    expect((result as Record<string, unknown>).num_batch).toBeUndefined();
  });

  it('passes tools through unchanged', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
    }];
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      tools,
    });
    expect(result.tools).toEqual(tools);
  });

  it('passes logprobs and top_logprobs through', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      logprobs: true,
      top_logprobs: 5,
    });
    expect(result.logprobs).toBe(true);
    expect(result.top_logprobs).toBe(5);
  });

  it('drops keep_alive and think', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
      keep_alive: '5m',
      think: true,
    });
    expect((result as Record<string, unknown>).keep_alive).toBeUndefined();
    expect((result as Record<string, unknown>).think).toBeUndefined();
  });

  it('handles request with no options', () => {
    const result = convertChatRequest({
      model: 'gemma3',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.model).toBe('astron-code-latest');
    expect(result.temperature).toBeUndefined();
  });
});

describe('convertGenerateRequest', () => {
  it('converts prompt to messages array', () => {
    const result = convertGenerateRequest({
      model: 'gemma3',
      prompt: 'Why is the sky blue?',
    });
    expect(result.messages).toEqual([{ role: 'user', content: 'Why is the sky blue?' }]);
    expect(result.model).toBe('astron-code-latest');
  });

  it('prepends system message when system field is present', () => {
    const result = convertGenerateRequest({
      model: 'gemma3',
      prompt: 'hello',
      system: 'You are a helpful assistant.',
    });
    expect(result.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('lifts options same as chat request', () => {
    const result = convertGenerateRequest({
      model: 'gemma3',
      prompt: 'hello',
      options: { temperature: 0.8, num_predict: 512 },
    });
    expect(result.temperature).toBe(0.8);
    expect(result.max_tokens).toBe(512);
  });

  it('drops template and context', () => {
    const result = convertGenerateRequest({
      model: 'gemma3',
      prompt: 'hello',
      template: '{{ .Prompt }}',
      context: [1, 2, 3],
    });
    expect((result as Record<string, unknown>).template).toBeUndefined();
    expect((result as Record<string, unknown>).context).toBeUndefined();
  });
});

describe('mapFormat', () => {
  it('returns undefined for undefined input', () => {
    expect(mapFormat(undefined)).toBeUndefined();
  });

  it('maps "json" to { type: "json_object" }', () => {
    expect(mapFormat('json')).toEqual({ type: 'json_object' });
  });

  it('maps JSON Schema object to { type: "json_schema", json_schema: ... }', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    expect(mapFormat(schema)).toEqual({ type: 'json_schema', json_schema: schema });
  });
});
