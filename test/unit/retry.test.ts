import { describe, it, expect } from 'bun:test';
import {
  isRetryableXfyunError,
  extractXfyunError,
  rewritePath,
  buildUpstreamUrl,
  RETRYABLE_STATUS_CODES,
  RETRYABLE_XFYUN_CODES,
} from '../../src/upstream';

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

  it('detects code 11210 NotEnoughCvError', () => {
    expect(
      isRetryableXfyunError(
        '{"code":11210,"msg":"NotEnoughCvError: FPM rate limit exceeded"}',
      ),
    ).toBe(true);
  });

  it('detects code 10010 RecvFromEngineError', () => {
    expect(
      isRetryableXfyunError('{"code":10010,"msg":"RecvFromEngineError: Engine Busy"}'),
    ).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isRetryableXfyunError('')).toBe(false);
  });
});

describe('extractXfyunError', () => {
  it('提取格式1: {"code":10012,"msg":"...","sid":"..."}', () => {
    const body = '{"code":10012,"msg":"EngineInternalError:error","sid":"cht000b3fc4@dx19e0072f47eb958700"}';
    const result = extractXfyunError(body);
    expect(result?.code).toBe(10012);
    expect(result?.msg).toBe('EngineInternalError:error');
    expect(result?.sid).toBe('cht000b3fc4@dx19e0072f47eb958700');
  });

  it('提取 SSE data: 前缀的格式1', () => {
    const body = 'data: {"code":10012,"msg":"EngineInternalError:error"}\n\n';
    const result = extractXfyunError(body);
    expect(result?.code).toBe(10012);
    expect(result?.msg).toBe('EngineInternalError:error');
  });

  // 真实场景：讯飞上游流式错误为 event: error + data: {"error":{"code":10012,"message":"..."}}
  // 错误信息在 error.message 内（含 "code: 10012, msg: ..." 文本），无顶层 msg 字段
  it('提取 SSE event:error 格式2（code 在 error.code，信息在 error.message）', () => {
    const body =
      'event: error\n' +
      'data: {"error":{"code":10012,"message":"Xunfei request failed with Sid: cht000db43e@dx19f11f76f0bba5c352 code: 10012, msg: EngineInternalError:1105, timeStamp:14:00:57.309"}}\n\n';
    const result = extractXfyunError(body);
    expect(result?.code).toBe(10012);
    expect(result?.msg).toBe('Xunfei request failed with Sid: cht000db43e@dx19f11f76f0bba5c352 code: 10012, msg: EngineInternalError:1105, timeStamp:14:00:57.309');
    // sid 在 message 文本内（Sid: cht...），应被 extractSidFromMsg 提取
    expect(result?.sid).toBe('cht000db43e@dx19f11f76f0bba5c352');
  });

  it('提取格式2: {"error":{"code":"ModelArts.81001","message":"..."}}', () => {
    const body = '{"error":{"code":"ModelArts.81001","message":"model not found"}}';
    const result = extractXfyunError(body);
    expect(result?.code).toBe('ModelArts.81001');
    expect(result?.msg).toBe('model not found');
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
  it('includes 429, 500 and 503', () => {
    expect(RETRYABLE_STATUS_CODES.has(429)).toBe(true);
    expect(RETRYABLE_STATUS_CODES.has(500)).toBe(true);
    expect(RETRYABLE_STATUS_CODES.has(503)).toBe(true);
  });

  it('does not include 200 or 400', () => {
    expect(RETRYABLE_STATUS_CODES.has(200)).toBe(false);
    expect(RETRYABLE_STATUS_CODES.has(400)).toBe(false);
  });
});

describe('RETRYABLE_XFYUN_CODES', () => {
  it('includes 10012, 10010, 11210', () => {
    expect(RETRYABLE_XFYUN_CODES.has(10012)).toBe(true);
    expect(RETRYABLE_XFYUN_CODES.has(10010)).toBe(true);
    expect(RETRYABLE_XFYUN_CODES.has(11210)).toBe(true);
  });

  it('does not include 1006 (WebSocket close code, not xfyun business code)', () => {
    expect(RETRYABLE_XFYUN_CODES.has(1006)).toBe(false);
  });
});
