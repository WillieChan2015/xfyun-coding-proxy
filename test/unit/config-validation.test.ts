import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { loadConfig, configSchema } from '../../src/config';

const ENV_KEYS = [
  'PORT',
  'MAX_RETRIES',
  'RETRY_DELAY_MS',
  'STREAM_READ_TIMEOUT_MS',
  'XFYUN_BASE_URL',
  'XFYUN_ANTHROPIC_BASE_URL',
] as const;

describe('config schema validation', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('rejects port 0', () => {
    process.env.PORT = '0';
    expect(() => loadConfig({ verbose: false })).toThrow(/port.*>= 1/);
  });

  it('rejects port above 65535', () => {
    process.env.PORT = '70000';
    expect(() => loadConfig({ verbose: false })).toThrow(/port.*<= 65535/);
  });

  it('rejects non-numeric port', () => {
    process.env.PORT = 'abc';
    expect(() => loadConfig({ verbose: false })).toThrow(/port/);
  });

  it('rejects negative maxRetries', () => {
    process.env.MAX_RETRIES = '-1';
    expect(() => loadConfig({ verbose: false })).toThrow(/maxRetries.*>= 0/);
  });

  it('rejects maxRetries above 10', () => {
    process.env.MAX_RETRIES = '11';
    expect(() => loadConfig({ verbose: false })).toThrow(/maxRetries.*<= 10/);
  });

  it('accepts valid config via CLI options', () => {
    const cfg = loadConfig({ verbose: false, apiKey: 'test-key' });
    expect(cfg.apiKey).toBe('test-key');
    expect(cfg.port).toBe(3000);
  });

  it('reports multiple errors at once', () => {
    process.env.PORT = '0';
    process.env.MAX_RETRIES = '-1';
    try {
      loadConfig({ verbose: false });
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/port/);
      expect(msg).toMatch(/maxRetries/);
    }
  });
});

describe('configSchema direct parse', () => {
  it('rejects empty apiKey', () => {
    const result = configSchema.safeParse({
      port: 3000,
      apiKey: '',
      baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
      anthropicBaseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic',
      maxRetries: 3,
      retryDelay: 1000,
      verbose: false,
      monitor: true,
      logDir: './logs',
      statsDir: './logs/stats',
      statsFlushInterval: 60000,
      streamReadTimeout: 60000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('apiKey');
      expect(result.error.issues[0].message).toMatch(/XFYUN_API_KEY is required/);
    }
  });

  it('rejects invalid baseUrl', () => {
    const result = configSchema.safeParse({
      port: 3000,
      apiKey: 'key',
      baseUrl: 'not-a-url',
      anthropicBaseUrl: 'https://example.com',
      maxRetries: 3,
      retryDelay: 1000,
      verbose: false,
      monitor: true,
      logDir: './logs',
      statsDir: './logs/stats',
      statsFlushInterval: 60000,
      streamReadTimeout: 60000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('baseUrl');
    }
  });

  it('reports multiple field errors together', () => {
    const result = configSchema.safeParse({
      port: 0,
      apiKey: '',
      baseUrl: 'bad',
      anthropicBaseUrl: 'bad',
      maxRetries: -1,
      retryDelay: 50,
      verbose: false,
      monitor: true,
      logDir: '',
      statsDir: '',
      statsFlushInterval: -1,
      streamReadTimeout: 100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths.length).toBeGreaterThanOrEqual(5);
    }
  });
});
