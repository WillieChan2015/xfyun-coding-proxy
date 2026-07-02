import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { debugLogRequest, debugLogResponse, debugLogUpstream, isDebugEnabled, resetDebugLogger, cleanupOldDebugLogs } from '../../src/debug-logger';

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

/** 计算偏移日期字符串 YYYY-MM-DD（daysAgo=0 表示今天） */
function dateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe('cleanupOldDebugLogs', () => {
  const TMP_DIR = join(import.meta.dir, '__debug_cleanup_test__');

  beforeEach(() => {
    resetDebugLogger();
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    resetDebugLogger();
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
    delete process.env.DEBUG_LOG_DIR;
    delete process.env.DEBUG_RETENTION_DAYS;
  });

  it('删除超过保留天数的旧 ndjson 文件，保留近期文件', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_RETENTION_DAYS = '7';
    resetDebugLogger();

    // 制造文件：2 天前（保留）、10 天前（删除）、30 天前（删除）
    writeFileSync(join(TMP_DIR, `${dateOffset(2)}.ndjson`), '{"x":1}\n');
    writeFileSync(join(TMP_DIR, `${dateOffset(10)}.ndjson`), '{"x":2}\n');
    writeFileSync(join(TMP_DIR, `${dateOffset(30)}.ndjson`), '{"x":3}\n');

    const deleted = cleanupOldDebugLogs();

    const remaining = readdirSync(TMP_DIR).sort();
    expect(remaining).toEqual([`${dateOffset(2)}.ndjson`]);
    expect(deleted).toBe(2);
  });

  it('默认保留 7 天，未配置环境变量时同样生效', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    resetDebugLogger();

    writeFileSync(join(TMP_DIR, `${dateOffset(7)}.ndjson`), '{"x":1}\n');   // 恰好 7 天，保留
    writeFileSync(join(TMP_DIR, `${dateOffset(8)}.ndjson`), '{"x":2}\n');   // 超期，删除

    const deleted = cleanupOldDebugLogs();

    const remaining = readdirSync(TMP_DIR).sort();
    expect(remaining).toEqual([`${dateOffset(7)}.ndjson`]);
    expect(deleted).toBe(1);
  });

  it('忽略非 ndjson 文件与无日期前缀的文件', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_RETENTION_DAYS = '1';
    resetDebugLogger();

    writeFileSync(join(TMP_DIR, `${dateOffset(10)}.ndjson`), '{"x":1}\n');  // 超期，删除
    writeFileSync(join(TMP_DIR, 'readme.txt'), 'hi');                        // 忽略
    writeFileSync(join(TMP_DIR, 'garbage.ndjson'), '{"x":2}\n');             // 非日期前缀，忽略

    const deleted = cleanupOldDebugLogs();

    const remaining = readdirSync(TMP_DIR).sort();
    expect(remaining).toEqual(['garbage.ndjson', 'readme.txt']);
    expect(deleted).toBe(1);
  });

  it('清理失败不影响流程，返回 0', () => {
    process.env.DEBUG_LOG_DIR = join(TMP_DIR, 'not-exists');
    resetDebugLogger();

    const deleted = cleanupOldDebugLogs();
    expect(deleted).toBe(0);
  });

  it('跨天首次写入日志时自动触发超期文件清理', () => {
    process.env.DEBUG_LOG_DIR = TMP_DIR;
    process.env.DEBUG_FORCE = '1';
    process.env.DEBUG_RETENTION_DAYS = '7';
    resetDebugLogger();

    // 预置一份 30 天前的超期文件
    writeFileSync(join(TMP_DIR, `${dateOffset(30)}.ndjson`), '{"x":1}\n');

    // 触发一次写入：getLogFilePath 跨天检测会顺带清理
    debugLogRequest('req-rollover', { method: 'GET', url: '/' });

    const remaining = readdirSync(TMP_DIR);
    // 旧文件应被删除，仅剩今天的日志文件
    expect(remaining).toEqual([remaining.find(f => f.endsWith('.ndjson') && f !== `${dateOffset(30)}.ndjson`)!]);
    expect(remaining).not.toContain(`${dateOffset(30)}.ndjson`);

    delete process.env.DEBUG_FORCE;
    delete process.env.DEBUG_RETENTION_DAYS;
  });
});
