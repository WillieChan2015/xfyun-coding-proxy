import { describe, it, expect, vi } from 'bun:test';
import { filterSSEEvents, SSEFilter, ALLOWED_SSE_EVENTS } from '../../src/proxy';

const mockLog = { debug: vi.fn() } as any;

describe('ALLOWED_SSE_EVENTS', () => {
  it('only contains "message"', () => {
    expect(ALLOWED_SSE_EVENTS.size).toBe(1);
    expect(ALLOWED_SSE_EVENTS.has('message')).toBe(true);
  });
});

describe('filterSSEEvents', () => {
  it('passes through standard data events unchanged', () => {
    const input = 'data: {"content":"hello"}\n\ndata: [DONE]\n\n';
    const result = filterSSEEvents(input, mockLog);
    expect(result).toBe(input);
  });

  it('passes through event: message events', () => {
    const input = 'event: message\ndata: {"content":"hello"}\n\n';
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

  it('filters out any unknown event type (whitelist strategy)', () => {
    const input = 'event: some_new_event\ndata: "surprise"\n\ndata: {"content":"hello"}\n\n';
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

describe('SSEFilter (stateful, cross-chunk)', () => {
  it('handles event: line split across two chunks', () => {
    const f = new SSEFilter();
    const chunk1 = 'event: progress';
    const chunk2 = '_notice\ndata: "Processing"\n\ndata: {"content":"hello"}\n\n';

    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);

    expect(out1).toBe('');
    expect(out2).toBe('data: {"content":"hello"}\n\n');
  });

  it('handles context_usage event split across chunks', () => {
    const f = new SSEFilter();
    const chunk1 = 'event: context_';
    const chunk2 = 'usage\ndata: {"tokens":100}\n\ndata: [DONE]\n\n';

    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);

    expect(out1).toBe('');
    expect(out2).toBe('data: [DONE]\n\n');
  });

  it('passes through normal data when event line is split but not blocked', () => {
    const f = new SSEFilter();
    const chunk1 = 'event: mes';
    const chunk2 = 'sage\ndata: {"content":"hi"}\n\n';

    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);

    expect(out1).toBe('');
    expect(out2).toBe('event: message\ndata: {"content":"hi"}\n\n');
  });

  it('handles data: line split across chunks while skipping', () => {
    const f = new SSEFilter();
    const chunk1 = 'event: progress_notice\ndata: "half';
    const chunk2 = '_of_data"\n\ndata: {"content":"ok"}\n\n';

    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);

    expect(out1).toBe('');
    expect(out2).toBe('data: {"content":"ok"}\n\n');
  });

  it('handles multiple chunks with mixed content', () => {
    const f = new SSEFilter();
    const chunk1 = 'data: {"content":"a"}\n\nevent: progress';
    const chunk2 = '_notice\ndata: "x"\n\ndata: {"content":"b"}\n\n';

    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);

    expect(out1).toBe('data: {"content":"a"}\n\n');
    expect(out2).toBe('data: {"content":"b"}\n\n');
  });

  it('handles chunk ending exactly at newline boundary', () => {
    const f = new SSEFilter();
    const chunk1 = 'event: progress_notice\n';
    const chunk2 = 'data: "x"\n\ndata: {"content":"ok"}\n\n';

    const out1 = f.filter(chunk1, mockLog);
    const out2 = f.filter(chunk2, mockLog);

    expect(out1).toBe('');
    expect(out2).toBe('data: {"content":"ok"}\n\n');
  });

  it('empty chunk produces no output', () => {
    const f = new SSEFilter();
    const out = f.filter('', mockLog);
    expect(out).toBe('');
  });
});
