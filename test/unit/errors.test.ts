import { describe, it, expect } from 'bun:test';
import {
  UpstreamError,
  StreamInterruptedError,
  NetworkError,
  formatOpenAIError,
  formatAnthropicError,
} from '../../src/errors';

describe('Error classes', () => {
  it('UpstreamError has correct properties', () => {
    const err = new UpstreamError(502, 'bad gateway');
    expect(err.name).toBe('UpstreamError');
    expect(err.status).toBe(502);
    expect(err.body).toBe('bad gateway');
    expect(err.message).toBe('upstream returned 502');
    expect(err).toBeInstanceOf(Error);
  });

  it('StreamInterruptedError has correct properties', () => {
    const err = new StreamInterruptedError('timeout');
    expect(err.name).toBe('StreamInterruptedError');
    expect(err.reason).toBe('timeout');
    expect(err.message).toBe('stream interrupted: timeout');
  });

  it('NetworkError has correct properties', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new NetworkError(cause);
    expect(err.name).toBe('NetworkError');
    expect(err.cause).toBe(cause);
    expect(err.message).toBe('network error: ECONNREFUSED');
  });
});

describe('formatOpenAIError', () => {
  it('formats with default code', () => {
    const result = formatOpenAIError(502, 'upstream failed');
    expect(result).toEqual({
      error: { message: 'upstream failed', type: 'upstream_error', code: 502 },
    });
  });

  it('formats with custom code', () => {
    const result = formatOpenAIError(500, 'rate limited', 'rate_limit');
    expect(result.error.code).toBe('rate_limit');
  });
});

describe('formatAnthropicError', () => {
  it('formats error response', () => {
    const result = formatAnthropicError('api_error', 'upstream failed');
    expect(result).toEqual({
      type: 'error',
      error: { type: 'api_error', message: 'upstream failed' },
    });
  });
});