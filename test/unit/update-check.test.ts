import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { isNewerVersion, readCache, writeCache, fetchLatestVersion, formatUpdateMessage, checkForUpdate } from '../../src/update-check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('isNewerVersion', () => {
  it('returns true when remote is newer', () => {
    expect(isNewerVersion('1.2.3', '1.2.4')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  it('returns false when remote is older', () => {
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(false);
  });

  it('compares major version', () => {
    expect(isNewerVersion('1.2.3', '2.0.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });

  it('compares minor version', () => {
    expect(isNewerVersion('1.2.3', '1.3.0')).toBe(true);
  });

  it('treats prerelease as lower than release', () => {
    expect(isNewerVersion('0.0.5-beta.4', '0.0.5')).toBe(true);
  });

  it('compares prerelease versions', () => {
    expect(isNewerVersion('0.0.5-beta.3', '0.0.5-beta.4')).toBe(true);
    expect(isNewerVersion('0.0.5-beta.4', '0.0.5-beta.3')).toBe(false);
  });

  it('returns false for same prerelease', () => {
    expect(isNewerVersion('0.0.5-beta.4', '0.0.5-beta.4')).toBe(false);
  });
});

const tmpDir = () => path.join(os.tmpdir(), `update-check-test-${Date.now()}`);

describe('cache read/write', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when cache file does not exist', () => {
    expect(readCache(dir)).toBeNull();
  });

  it('returns null when cache file is invalid JSON', () => {
    fs.writeFileSync(path.join(dir, '.update-check.json'), 'not json');
    expect(readCache(dir)).toBeNull();
  });

  it('writes and reads back cache', () => {
    writeCache(dir, { lastCheck: 1234, latestVersion: '1.0.0' });
    const cached = readCache(dir);
    expect(cached).toEqual({ lastCheck: 1234, latestVersion: '1.0.0' });
  });

  it('deletes corrupted cache file', () => {
    const filePath = path.join(dir, '.update-check.json');
    fs.writeFileSync(filePath, 'bad');
    readCache(dir);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

describe('fetchLatestVersion', () => {
  afterEach(() => {
    globalThis.fetch = undefined as any;
  });

  it('returns version from registry', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '2.0.0' }) } as any),
    );

    const version = await fetchLatestVersion();
    expect(version).toBe('2.0.0');
  });

  it('returns null on network error', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network')));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    globalThis.fetch = mock(() => Promise.resolve({ ok: false } as any));
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe('formatUpdateMessage', () => {
  it('formats update message with ANSI color when TTY', () => {
    const msg = formatUpdateMessage('0.0.5-beta.4', '0.0.6', true);
    expect(msg).toContain('0.0.5-beta.4');
    expect(msg).toContain('0.0.6');
    expect(msg).toContain('npm i -g maas-coding-proxy');
    expect(msg).toContain('\x1b[33m');
  });

  it('formats update message without ANSI color when not TTY', () => {
    const msg = formatUpdateMessage('0.0.5-beta.4', '0.0.6', false);
    expect(msg).not.toContain('\x1b[');
    expect(msg).toContain('0.0.5-beta.4');
    expect(msg).toContain('0.0.6');
  });
});

describe('checkForUpdate', () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(os.tmpdir(), `update-check-integration-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.NO_UPDATE_CHECK;
    globalThis.fetch = undefined as any;
  });

  it('does nothing when NO_UPDATE_CHECK is set', async () => {
    process.env.NO_UPDATE_CHECK = '1';
    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;

    await checkForUpdate(dir, '1.0.0');

    console.log = origLog;
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('uses cached version when cache is fresh', async () => {
    const now = Date.now();
    fs.writeFileSync(
      path.join(dir, '.update-check.json'),
      JSON.stringify({ lastCheck: now, latestVersion: '2.0.0' }),
    );
    globalThis.fetch = mock(() => { throw new Error('should not call fetch'); });

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;

    await checkForUpdate(dir, '1.0.0');

    console.log = origLog;
    expect(logSpy).toHaveBeenCalled();
  });

  it('fetches registry when cache is stale', async () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    fs.writeFileSync(
      path.join(dir, '.update-check.json'),
      JSON.stringify({ lastCheck: stale, latestVersion: '1.0.0' }),
    );
    globalThis.fetch = mock(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '2.0.0' }) } as any),
    );

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;

    await checkForUpdate(dir, '1.0.0');

    console.log = origLog;
    expect(logSpy).toHaveBeenCalled();
  });

  it('does not log when already up to date', async () => {
    const now = Date.now();
    fs.writeFileSync(
      path.join(dir, '.update-check.json'),
      JSON.stringify({ lastCheck: now, latestVersion: '1.0.0' }),
    );

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;

    await checkForUpdate(dir, '1.0.0');

    console.log = origLog;
    expect(logSpy).not.toHaveBeenCalled();
  });
});
