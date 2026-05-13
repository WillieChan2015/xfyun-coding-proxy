import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DailyStats,
  ProtocolStats,
  dailyStats,
  sessionStats,
  todayStr,
  resolveStatsDir,
  resolveStatsFile,
  loadDailyStats,
  saveDailyStats,
  initDailyStats,
  listStatsDates,
  isValidDate,
  incrementProtocolStats,
  printDailyStats,
  printStatsHistory,
  printSessionSummary,
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
      protocols: {},
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
      protocols: {},
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
      protocols: {},
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

describe('incrementProtocolStats', () => {
  it('initializes and increments a new protocol', () => {
    const stats = { protocols: {} as Record<string, ProtocolStats> };
    incrementProtocolStats(stats, 'openai', { requestCount: 1, totalPromptTokens: 100 });
    expect(stats.protocols.openai).toEqual({
      requestCount: 1,
      totalPromptTokens: 100,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
    });
  });

  it('accumulates into existing protocol', () => {
    const stats = {
      protocols: {
        openai: { requestCount: 5, totalPromptTokens: 500, totalCompletionTokens: 200, retries: 0, errors: 1 },
      } as Record<string, ProtocolStats>,
    };
    incrementProtocolStats(stats, 'openai', { requestCount: 1, errors: 1 });
    expect(stats.protocols.openai.requestCount).toBe(6);
    expect(stats.protocols.openai.errors).toBe(2);
    expect(stats.protocols.openai.totalPromptTokens).toBe(500);
  });

  it('handles multiple protocols independently', () => {
    const stats = { protocols: {} as Record<string, ProtocolStats> };
    incrementProtocolStats(stats, 'openai', { requestCount: 1 });
    incrementProtocolStats(stats, 'anthropic', { requestCount: 2 });
    expect(stats.protocols.openai.requestCount).toBe(1);
    expect(stats.protocols.anthropic.requestCount).toBe(2);
  });
});

describe('protocols field initialization', () => {
  it('sessionStats has empty protocols', () => {
    expect(sessionStats.protocols).toEqual({});
  });

  it('loadDailyStats returns empty protocols for old format file', () => {
    const dir = join(TMP_DIR, 'compat', 'stats');
    mkdirSync(dir, { recursive: true });
    const oldFormat = JSON.stringify({
      date: '2026-05-09',
      requestCount: 50,
      totalPromptTokens: 5000,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
    });
    writeFileSync(join(dir, '2026-05-09.json'), oldFormat, 'utf-8');
    const stats = loadDailyStats(join(TMP_DIR, 'compat'), '2026-05-09');
    expect(stats).not.toBeNull();
    expect(stats!.protocols).toEqual({});
  });

  it('loadDailyStats preserves protocols from new format file', () => {
    const dir = join(TMP_DIR, 'compat2', 'stats');
    mkdirSync(dir, { recursive: true });
    const newFormat = JSON.stringify({
      date: '2026-05-11',
      requestCount: 303,
      totalPromptTokens: 12692653,
      totalCompletionTokens: 73297,
      retries: 1,
      errors: 2,
      protocols: {
        anthropic: { requestCount: 280, totalPromptTokens: 12650000, totalCompletionTokens: 70000, retries: 1, errors: 2 },
      },
    });
    writeFileSync(join(dir, '2026-05-11.json'), newFormat, 'utf-8');
    const stats = loadDailyStats(join(TMP_DIR, 'compat2'), '2026-05-11');
    expect(stats).not.toBeNull();
    expect(stats!.protocols.anthropic.requestCount).toBe(280);
  });
});

function captureOutput(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines.join('\n');
}

describe('printDailyStats with protocols', () => {
  it('includes By Protocol section when protocols exist', () => {
    const stats: DailyStats = {
      date: '2026-05-11',
      requestCount: 303,
      totalPromptTokens: 12692653,
      totalCompletionTokens: 73297,
      retries: 1,
      errors: 2,
      protocols: {
        anthropic: { requestCount: 280, totalPromptTokens: 12650000, totalCompletionTokens: 70000, retries: 1, errors: 2 },
        openai: { requestCount: 20, totalPromptTokens: 12000, totalCompletionTokens: 1797, retries: 0, errors: 0 },
        ollama: { requestCount: 3, totalPromptTokens: 1500, totalCompletionTokens: 1500, retries: 0, errors: 0 },
      },
    };
    const output = captureOutput(() => printDailyStats('2026-05-11', stats));
    expect(output).toContain('By Protocol:');
    expect(output).toContain('anthropic');
    expect(output).toContain('openai');
    expect(output).toContain('ollama');
  });

  it('omits By Protocol section when protocols is empty', () => {
    const stats: DailyStats = {
      date: '2026-05-09',
      requestCount: 50,
      totalPromptTokens: 5000,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
      protocols: {},
    };
    const output = captureOutput(() => printDailyStats('2026-05-09', stats));
    expect(output).not.toContain('By Protocol:');
  });
});

describe('printStatsHistory with protocols', () => {
  it('includes Protocols column with protocol counts', () => {
    const dir = join(TMP_DIR, 'history-proto', 'stats');
    mkdirSync(dir, { recursive: true });
    const stats: DailyStats = {
      date: '2026-05-11',
      requestCount: 303,
      totalPromptTokens: 12692653,
      totalCompletionTokens: 73297,
      retries: 1,
      errors: 2,
      protocols: {
        anthropic: { requestCount: 280, totalPromptTokens: 12650000, totalCompletionTokens: 70000, retries: 1, errors: 2 },
        openai: { requestCount: 20, totalPromptTokens: 12000, totalCompletionTokens: 1797, retries: 0, errors: 0 },
      },
    };
    writeFileSync(join(dir, '2026-05-11.json'), JSON.stringify(stats), 'utf-8');
    const output = captureOutput(() => printStatsHistory(join(TMP_DIR, 'history-proto')));
    expect(output).toContain('Protocols');
    expect(output).toContain('anthropic(280)');
    expect(output).toContain('openai(20)');
  });

  it('shows dash when no protocols data', () => {
    const dir = join(TMP_DIR, 'history-noproto', 'stats');
    mkdirSync(dir, { recursive: true });
    const stats: DailyStats = {
      date: '2026-05-09',
      requestCount: 50,
      totalPromptTokens: 5000,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
      protocols: {},
    };
    writeFileSync(join(dir, '2026-05-09.json'), JSON.stringify(stats), 'utf-8');
    const output = captureOutput(() => printStatsHistory(join(TMP_DIR, 'history-noproto')));
    expect(output).toContain(' -');
  });
});

describe('printSessionSummary with protocols', () => {
  it('includes By Protocol in session section', () => {
    sessionStats.requestCount = 15;
    sessionStats.totalPromptTokens = 5200;
    sessionStats.totalCompletionTokens = 7300;
    sessionStats.retries = 3;
    sessionStats.errors = 1;
    sessionStats.protocols = {
      anthropic: { requestCount: 7, totalPromptTokens: 3000, totalCompletionTokens: 7500, retries: 3, errors: 1 },
      openai: { requestCount: 8, totalPromptTokens: 2200, totalCompletionTokens: -200, retries: 0, errors: 0 },
    };
    const output = captureOutput(() => printSessionSummary());
    expect(output).toContain('By Protocol:');
    expect(output).toContain('anthropic');
    expect(output).toContain('openai');

    // Reset sessionStats after test
    sessionStats.requestCount = 0;
    sessionStats.totalPromptTokens = 0;
    sessionStats.totalCompletionTokens = 0;
    sessionStats.retries = 0;
    sessionStats.errors = 0;
    sessionStats.protocols = {};
  });

  it('includes protocol summary in Today section when protocols exist', () => {
    const origDate = dailyStats.date;
    dailyStats.date = '2026-05-11';
    dailyStats.requestCount = 10;
    dailyStats.totalPromptTokens = 1000;
    dailyStats.totalCompletionTokens = 500;
    dailyStats.protocols = {
      openai: { requestCount: 7, totalPromptTokens: 700, totalCompletionTokens: 300, retries: 0, errors: 0 },
      anthropic: { requestCount: 3, totalPromptTokens: 300, totalCompletionTokens: 200, retries: 0, errors: 0 },
    };
    const output = captureOutput(() => printSessionSummary());
    expect(output).toMatch(/openai\s+7 req/);
    expect(output).toMatch(/anthropic\s+3 req/);
    expect(output).toContain('1000 tok');
    expect(output).toContain('500 tok');

    // Reset
    dailyStats.date = origDate;
    dailyStats.requestCount = 0;
    dailyStats.totalPromptTokens = 0;
    dailyStats.totalCompletionTokens = 0;
    dailyStats.protocols = {};
  });

  it('omits By Protocol when protocols is empty', () => {
    const output = captureOutput(() => printSessionSummary());
    expect(output).not.toContain('By Protocol:');
  });
});
