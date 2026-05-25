import { describe, it, expect, beforeEach } from 'bun:test';
import { createServer } from '../../src/server';
import { resetConfigForTesting } from '../../src/config';
import type { ResolvedConfig } from '../../src/config';

const testConfig: ResolvedConfig = {
  port: 0,
  apiKey: 'test-key',
  baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
  anthropicBaseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic',
  maxRetries: 0,
  retryDelay: 100,
  verbose: false,
  monitor: false,
  logDir: '/tmp/test-logs',
  statsDir: '/tmp/test-logs/stats',
  statsFlushInterval: 0,
  streamReadTimeout: 5000,
  upstreamFetchTimeout: 5000,
  configFile: undefined,
};

describe('Proxy Integration', () => {
  beforeEach(() => {
    resetConfigForTesting();
  });

  it('GET /health returns ok', async () => {
    const server = await createServer(testConfig);
    try {
      const res = await server.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.upstream).toBe(testConfig.baseUrl);
    } finally {
      await server.close();
    }
  });

  it('POST /v1/chat/completions returns error when upstream is unreachable', async () => {
    const configWithBadUpstream = {
      ...testConfig,
      baseUrl: 'http://localhost:1', // 不存在的上游
    };
    const server = await createServer(configWithBadUpstream);
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'test',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });
      // 应该返回错误响应
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const body = res.json();
      expect(body.error).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it('GET /anthropic/v1/models returns model list', async () => {
    const server = await createServer(testConfig);
    try {
      const res = await server.inject({ method: 'GET', url: '/anthropic/v1/models' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.data).toBeArray();
    } finally {
      await server.close();
    }
  });

  it('HEAD /anthropic returns 200', async () => {
    const server = await createServer(testConfig);
    try {
      const res = await server.inject({ method: 'HEAD', url: '/anthropic' });
      expect(res.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('GET /ollama/api/tags returns model list', async () => {
    const server = await createServer(testConfig);
    try {
      const res = await server.inject({ method: 'GET', url: '/ollama/api/tags' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.models).toBeArray();
    } finally {
      await server.close();
    }
  });

  it('GET /ollama/api/version returns version', async () => {
    const server = await createServer(testConfig);
    try {
      const res = await server.inject({ method: 'GET', url: '/ollama/api/version' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it('404 for unknown routes', async () => {
    const server = await createServer(testConfig);
    try {
      const res = await server.inject({ method: 'GET', url: '/unknown' });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('not found');
    } finally {
      await server.close();
    }
  });
});
