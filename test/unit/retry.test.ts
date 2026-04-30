import { describe, it, expect } from 'vitest';
import {
  isRetryableXfyunError,
  rewritePath,
  buildUpstreamUrl,
  RETRYABLE_STATUS_CODES,
  RETRYABLE_XFYUN_CODES,
} from '../../src/proxy';

describe('isRetryableXfyunError', () => {
  it('detects code 10012 without space', () => {
    expect(isRetryableXfyunError('{"code":10012,"msg":"error"}')).toBe(true);
  });

  it('detects code 10012 with space', () => {
    expect(isRetryableXfyunError('{"code": 10012, "msg":"error"}')).toBe(true);
  });

  it('does not match other codes', () => {
    expect(isRetryableXfyunError('{"code":400,"msg":"bad request"}')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRetryableXfyunError('')).toBe(false);
  });
});

describe('rewritePath', () => {
  it('rewrites /v1 prefix', () => {
    expect(rewritePath('/v1/chat/completions')).toBe('/chat/completions');
  });

  it('does not rewrite paths without /v1', () => {
    expect(rewritePath('/chat/completions')).toBe('/chat/completions');
  });

  it('only rewrites leading /v1', () => {
    expect(rewritePath('/api/v1/something')).toBe('/api/v1/something');
  });
});

describe('buildUpstreamUrl', () => {
  it('combines base URL and rewritten path', () => {
    const url = buildUpstreamUrl('/v1/chat/completions');
    expect(url).toBe('https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions');
  });

  it('strips trailing slash from base URL', () => {
    const url = buildUpstreamUrl('/v1/models');
    expect(url).toContain('/v2/models');
  });
});

describe('RETRYABLE_STATUS_CODES', () => {
  it('includes 429 and 503', () => {
    expect(RETRYABLE_STATUS_CODES.has(429)).toBe(true);
    expect(RETRYABLE_STATUS_CODES.has(503)).toBe(true);
  });

  it('does not include 200 or 500', () => {
    expect(RETRYABLE_STATUS_CODES.has(200)).toBe(false);
    expect(RETRYABLE_STATUS_CODES.has(500)).toBe(false);
  });
});

describe('RETRYABLE_XFYUN_CODES', () => {
  it('includes 10012', () => {
    expect(RETRYABLE_XFYUN_CODES.has(10012)).toBe(true);
  });
});
