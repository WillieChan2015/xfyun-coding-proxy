import { describe, it, expect } from 'bun:test';
import { ANTHROPIC_SSE_EVENTS } from '../../src/anthropic/types';

describe('ANTHROPIC_SSE_EVENTS', () => {
  it('contains all standard Anthropic SSE event types', () => {
    expect(ANTHROPIC_SSE_EVENTS.has('message_start')).toBe(true);
    expect(ANTHROPIC_SSE_EVENTS.has('content_block_start')).toBe(true);
    expect(ANTHROPIC_SSE_EVENTS.has('content_block_delta')).toBe(true);
    expect(ANTHROPIC_SSE_EVENTS.has('content_block_stop')).toBe(true);
    expect(ANTHROPIC_SSE_EVENTS.has('message_delta')).toBe(true);
    expect(ANTHROPIC_SSE_EVENTS.has('message_stop')).toBe(true);
    expect(ANTHROPIC_SSE_EVENTS.has('ping')).toBe(true);
  });

  it('does not contain OpenAI event types', () => {
    expect(ANTHROPIC_SSE_EVENTS.has('message')).toBe(false);
  });

  it('does not contain non-standard event types', () => {
    expect(ANTHROPIC_SSE_EVENTS.has('progress_notice')).toBe(false);
    expect(ANTHROPIC_SSE_EVENTS.has('context_usage')).toBe(false);
  });

  it('has exactly 7 event types', () => {
    expect(ANTHROPIC_SSE_EVENTS.size).toBe(7);
  });
});
