import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { debugLogRequest, debugLogResponse, debugLogUpstream, isDebugEnabled, resetDebugLogger } from '../../src/debug-logger';

const TMP_DIR = join(import.meta.dir, '__debug_test__');

describe('debug-logger', () => {
  beforeEach(() => {
    resetDebugLogger();
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    resetDebugLogger();
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  });

  it('debug 未开启时不写文件', () => {
    // 默认 config.debug = false，且无 DEBUG_FORCE
    debugLogRequest('req-noop', { method: 'GET', url: '/' });
    const files = readdirSync(TMP_DIR);
    expect(files.length).toBe(0);
  });

  it('debugLogRequest 写入 NDJSON 行，包含 reqId 和 type=request', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_FORCE = '1';
    resetDebugLogger();

    debugLogRequest('req-test1', {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: { model: 'test', messages: [{ role: 'user', content: 'hi' }] },
    });

    const files = readdirSync(TMP_DIR);
    expect(files.length).toBe(1);

    const line = readFileSync(join(TMP_DIR, files[0]), 'utf-8').trim();
    const parsed = JSON.parse(line);
    expect(parsed.reqId).toBe('req-test1');
    expect(parsed.type).toBe('request');
    expect(parsed.data.method).toBe('POST');
    expect(parsed.data.body.model).toBe('test');

    delete process.env.DEBUG_LOG_DIR;
    delete process.env.DEBUG_FORCE;
  });

  it('debugLogResponse 写入 NDJSON 行，包含 reqId 和 type=response', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_FORCE = '1';
    resetDebugLogger();

    debugLogResponse('req-test2', {
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: ['data: {"content":"hello"}\n\n', 'data: [DONE]\n\n'],
    });

    const files = readdirSync(TMP_DIR);
    const line = readFileSync(join(TMP_DIR, files[0]), 'utf-8').trim();
    const parsed = JSON.parse(line);
    expect(parsed.reqId).toBe('req-test2');
    expect(parsed.type).toBe('response');
    expect(parsed.data.statusCode).toBe(200);
    expect(parsed.data.bodyChunks.length).toBe(2);

    delete process.env.DEBUG_LOG_DIR;
    delete process.env.DEBUG_FORCE;
  });

  it('debugLogUpstream 写入 NDJSON 行，包含 reqId 和 type=upstream', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_FORCE = '1';
    resetDebugLogger();

    debugLogUpstream('req-test3', {
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      bodyChunks: ['data: {"choices":[]}\n\n'],
    });

    const files = readdirSync(TMP_DIR);
    const line = readFileSync(join(TMP_DIR, files[0]), 'utf-8').trim();
    const parsed = JSON.parse(line);
    expect(parsed.reqId).toBe('req-test3');
    expect(parsed.type).toBe('upstream');
    expect(parsed.data.statusCode).toBe(200);

    delete process.env.DEBUG_LOG_DIR;
    delete process.env.DEBUG_FORCE;
  });

  it('同一 reqId 的多条日志追加到同一文件', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_FORCE = '1';
    resetDebugLogger();

    debugLogRequest('req-multi', { method: 'POST', url: '/v1/chat/completions', headers: {}, body: {} });
    debugLogUpstream('req-multi', { statusCode: 200, headers: {}, bodyChunks: [] });
    debugLogResponse('req-multi', { statusCode: 200, headers: {}, bodyChunks: [] });

    const files = readdirSync(TMP_DIR);
    const lines = readFileSync(join(TMP_DIR, files[0]), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines.map(l => JSON.parse(l).type)).toEqual(['request', 'upstream', 'response']);

    delete process.env.DEBUG_LOG_DIR;
    delete process.env.DEBUG_FORCE;
  });
});
