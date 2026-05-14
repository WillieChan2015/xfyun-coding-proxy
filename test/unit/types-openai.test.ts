import { describe, it, expect } from 'bun:test';
import {
  isChatCompletionRequest,
  isChatCompletionResponse,
  isUsageInfo,
} from '../../src/types/openai';

describe('OpenAI type guards', () => {
  it('isChatCompletionRequest accepts valid request', () => {
    expect(isChatCompletionRequest({ model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] })).toBe(true);
  });

  it('isChatCompletionRequest rejects missing model', () => {
    expect(isChatCompletionRequest({ messages: [{ role: 'user', content: 'hi' }] })).toBe(false);
  });

  it('isChatCompletionRequest rejects missing messages', () => {
    expect(isChatCompletionRequest({ model: 'gpt-4' })).toBe(false);
  });

  it('isChatCompletionRequest rejects null', () => {
    expect(isChatCompletionRequest(null)).toBe(false);
  });

  it('isChatCompletionResponse accepts valid response', () => {
    expect(isChatCompletionResponse({
      id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    })).toBe(true);
  });

  it('isChatCompletionResponse rejects wrong object type', () => {
    expect(isChatCompletionResponse({
      id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-4',
      choices: [],
    })).toBe(false);
  });

  it('isUsageInfo accepts valid usage', () => {
    expect(isUsageInfo({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toBe(true);
  });

  it('isUsageInfo rejects missing fields', () => {
    expect(isUsageInfo({ prompt_tokens: 10 })).toBe(false);
  });

  it('isUsageInfo rejects non-number fields', () => {
    expect(isUsageInfo({ prompt_tokens: '10', completion_tokens: 5, total_tokens: 15 })).toBe(false);
  });
});