import { describe, it, expect, vi } from 'vitest';
import { filterSSEEvents } from '../../src/proxy';

const mockLog = { debug: vi.fn() } as any;

describe('filterSSEEvents', () => {
  it('passes through standard data events unchanged', () => {
    const input = 'data: {"content":"hello"}\n\ndata: [DONE]\n\n';
    const result = filterSSEEvents(input, mockLog);
    expect(result).toBe(input);
  });

  it('filters out progress_notice events', () => {
    const input = 'event: progress_notice\ndata: "Processing_123"\n\ndata: {"content":"hello"}\n\n';
    const result = filterSSEEvents(input, mockLog);
    expect(result).toBe('data: {"content":"hello"}\n\n');
  });

  it('filters out context_usage events', () => {
    const input = 'event: context_usage\ndata: {"tokens":100}\n\ndata: {"content":"hello"}\n\n';
    const result = filterSSEEvents(input, mockLog);
    expect(result).toBe('data: {"content":"hello"}\n\n');
  });

  it('handles mixed blocked and standard events', () => {
    const input =
      'event: progress_notice\ndata: "Processing"\n\ndata: {"content":"hello"}\n\nevent: context_usage\ndata: {"tokens":100}\n\ndata: [DONE]\n\n';
    const result = filterSSEEvents(input, mockLog);
    expect(result).toBe('data: {"content":"hello"}\n\ndata: [DONE]\n\n');
  });

  it('handles multiple consecutive blocked events', () => {
    const input =
      'event: progress_notice\ndata: "P1"\n\nevent: progress_notice\ndata: "P2"\n\ndata: {"content":"ok"}\n\n';
    const result = filterSSEEvents(input, mockLog);
    expect(result).toBe('data: {"content":"ok"}\n\n');
  });

  it('handles empty input', () => {
    const result = filterSSEEvents('', mockLog);
    expect(result).toBe('');
  });

  it('calls log.debug when filtering an event', () => {
    const input = 'event: progress_notice\ndata: "x"\n\ndata: {"content":"y"}\n\n';
    filterSSEEvents(input, mockLog);
    expect(mockLog.debug).toHaveBeenCalledWith('filtered SSE event: progress_notice');
  });
});
