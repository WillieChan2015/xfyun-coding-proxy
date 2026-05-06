import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DailyStats,
  dailyStats,
  todayStr,
  resolveStatsDir,
  resolveStatsFile,
  loadDailyStats,
  saveDailyStats,
  initDailyStats,
  listStatsDates,
  isValidDate,
} from '../../src/stats';

const TMP_DIR = join(import.meta.dir, '..', 'tmp-stats-test');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('todayStr', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayStr();
    expect(/^\d{4}-\d{2}-\d{2}$/.test(result)).toBe(true);
  });
});

describe('isValidDate', () => {
  it('accepts valid YYYY-MM-DD', () => {
    expect(isValidDate('2025-05-06')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidDate('2025/05/06')).toBe(false);
    expect(isValidDate('05-06-2025')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});

describe('resolveStatsDir', () => {
  it('appends stats to logDir', () => {
    expect(resolveStatsDir('/tmp/logs')).toBe('/tmp/logs/stats');
  });
});

describe('resolveStatsFile', () => {
  it('constructs correct file path', () => {
    expect(resolveStatsFile('/tmp/logs', '2025-05-06')).toBe(
      '/tmp/logs/stats/2025-05-06.json',
    );
  });
});

describe('saveDailyStats / loadDailyStats', () => {
  it('round-trips stats to file', () => {
    const stats: DailyStats = {
      date: '2025-05-06',
      requestCount: 42,
      totalPromptTokens: 15000,
      totalCompletionTokens: 8500,
      retries: 3,
      errors: 1,
    };
    saveDailyStats(TMP_DIR, stats);
    const loaded = loadDailyStats(TMP_DIR, '2025-05-06');
    expect(loaded).toEqual(stats);
  });

  it('creates stats directory if missing', () => {
    const nestedDir = join(TMP_DIR, 'nested', 'deep');
    const stats: DailyStats = {
      date: '2025-05-06',
      requestCount: 1,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
    };
    saveDailyStats(nestedDir, stats);
    expect(existsSync(join(nestedDir, 'stats', '2025-05-06.json'))).toBe(true);
  });

  it('returns null for missing date', () => {
    expect(loadDailyStats(TMP_DIR, '2099-12-31')).toBeNull();
  });

  it('returns null for corrupted file', () => {
    const dir = join(TMP_DIR, 'stats');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2025-05-06.json'), 'not json', 'utf-8');
    expect(loadDailyStats(TMP_DIR, '2025-05-06')).toBeNull();
  });

  it('returns null for file with wrong structure', () => {
    const dir = join(TMP_DIR, 'stats');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2025-05-06.json'), '{"date":"2025-05-06"}', 'utf-8');
    expect(loadDailyStats(TMP_DIR, '2025-05-06')).toBeNull();
  });
});

describe('initDailyStats', () => {
  it('initializes from existing file', () => {
    const today = todayStr();
    const stats: DailyStats = {
      date: today,
      requestCount: 10,
      totalPromptTokens: 5000,
      totalCompletionTokens: 3000,
      retries: 1,
      errors: 0,
    };
    saveDailyStats(TMP_DIR, stats);
    initDailyStats(TMP_DIR);
    expect(dailyStats.date).toBe(today);
    expect(dailyStats.requestCount).toBe(10);
    expect(dailyStats.totalPromptTokens).toBe(5000);
  });

  it('initializes fresh when no file exists', () => {
    initDailyStats(TMP_DIR);
    expect(dailyStats.date).toBe(todayStr());
    expect(dailyStats.requestCount).toBe(0);
    expect(dailyStats.totalPromptTokens).toBe(0);
  });
});

describe('listStatsDates', () => {
  it('lists dates descending', () => {
    const dir = join(TMP_DIR, 'stats');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2025-05-04.json'), '{}', 'utf-8');
    writeFileSync(join(dir, '2025-05-06.json'), '{}', 'utf-8');
    writeFileSync(join(dir, '2025-05-05.json'), '{}', 'utf-8');
    const dates = listStatsDates(TMP_DIR);
    expect(dates).toEqual(['2025-05-06', '2025-05-05', '2025-05-04']);
  });

  it('ignores non-date files', () => {
    const dir = join(TMP_DIR, 'stats');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2025-05-06.json'), '{}', 'utf-8');
    writeFileSync(join(dir, 'readme.txt'), 'hello', 'utf-8');
    const dates = listStatsDates(TMP_DIR);
    expect(dates).toEqual(['2025-05-06']);
  });

  it('returns empty array for missing directory', () => {
    expect(listStatsDates(join(TMP_DIR, 'nonexistent'))).toEqual([]);
  });
});
