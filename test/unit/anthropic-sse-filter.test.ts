import { describe, it, expect, vi } from 'bun:test';
import { SSEFilter } from '../../src/upstream';
import { ANTHROPIC_SSE_EVENTS } from '../../src/anthropic/types';

const mockLog = { debug: vi.fn() } as any;

describe('SSEFilter with Anthropic event whitelist', () => {
  it('passes through message_start events', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: message_start\ndata: {"type":"message_start"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe(input);
  });

  it('passes through content_block_delta events', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe(input);
  });

  it('passes through message_stop events', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe(input);
  });

  it('passes through ping events', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: ping\ndata: {"type":"ping"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe(input);
  });

  it('filters out progress_notice events', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: progress_notice\ndata: "Processing"\n\nevent: content_block_delta\ndata: {"type":"content_block_delta"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n');
  });

  it('filters out context_usage events', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: context_usage\ndata: {"tokens":100}\n\nevent: message_delta\ndata: {"type":"message_delta"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe('event: message_delta\ndata: {"type":"message_delta"}\n\n');
  });

  it('filters out any unknown event type (whitelist strategy)', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'event: some_new_event\ndata: "surprise"\n\nevent: message_start\ndata: {"type":"message_start"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe('event: message_start\ndata: {"type":"message_start"}\n\n');
  });

  it('handles event: line split across two chunks', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const chunk1 = 'event: progress';
    const chunk2 = '_notice\ndata: "Processing"\n\nevent: content_block_delta\ndata: {"type":"content_block_delta"}\n\n';
    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);
    expect(out1).toBe('');
    expect(out2).toBe('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n');
  });

  it('handles content_block_start event split across chunks', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const chunk1 = 'event: content_block_';
    const chunk2 = 'start\ndata: {"type":"content_block_start"}\n\n';
    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);
    expect(out1).toBe('');
    expect(out2).toBe('event: content_block_start\ndata: {"type":"content_block_start"}\n\n');
  });

  it('passes through data lines without event: prefix (default event)', () => {
    const f = new SSEFilter(ANTHROPIC_SSE_EVENTS);
    const input = 'data: {"type":"message_start"}\n\n';
    const result = f.filter(input, mockLog);
    expect(result).toBe(input);
  });
});
