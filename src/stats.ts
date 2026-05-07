import { fmtTokens } from './util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const sessionStats = {
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  retries: 0,
  errors: 0,
  startTime: Date.now(),
};

function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export interface DailyStats {
  date: string;
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
}

export const dailyStats: DailyStats = {
  date: '',
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  retries: 0,
  errors: 0,
};

export function todayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveStatsDir(logDir: string): string {
  return join(logDir, 'stats');
}

export function resolveStatsFile(logDir: string, date: string): string {
  return join(resolveStatsDir(logDir), `${date}.json`);
}

export function loadDailyStats(logDir: string, date: string): DailyStats | null {
  const file = resolveStatsFile(logDir, date);
  if (!existsSync(file)) return null;
  try {
    const content = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content);
    if (
      typeof parsed.date === 'string' &&
      typeof parsed.requestCount === 'number' &&
      typeof parsed.totalPromptTokens === 'number' &&
      typeof parsed.totalCompletionTokens === 'number' &&
      typeof parsed.retries === 'number' &&
      typeof parsed.errors === 'number'
    ) {
      return parsed as DailyStats;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveDailyStats(logDir: string, stats: DailyStats): void {
  try {
    const dir = resolveStatsDir(logDir);
    mkdirSync(dir, { recursive: true });
    const file = resolveStatsFile(logDir, stats.date);
    writeFileSync(file, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save daily stats:', err);
  }
}

export function initDailyStats(logDir: string): void {
  const today = todayStr();
  const existing = loadDailyStats(logDir, today);
  if (existing) {
    Object.assign(dailyStats, existing);
  } else {
    dailyStats.date = today;
    dailyStats.requestCount = 0;
    dailyStats.totalPromptTokens = 0;
    dailyStats.totalCompletionTokens = 0;
    dailyStats.retries = 0;
    dailyStats.errors = 0;
  }
}

export function listStatsDates(logDir: string): string[] {
  const dir = resolveStatsDir(logDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map(file => file.replace(/\.json$/, ''))
    .sort((a, b) => b.localeCompare(a));
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function printDailyStats(date: string, stats: DailyStats | null): void {
  if (!stats) {
    console.log(`No stats available for ${date}`);
    return;
  }
  const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log(`  Daily Stats — ${date}`);
  console.log('════════════════════════════════════════════════');
  console.log(`  Requests:       ${stats.requestCount}`);
  console.log(`  Tokens:         ${fmtTokens(totalTokens)}`);
  console.log(`    Input:        ${fmtTokens(stats.totalPromptTokens)}`);
  console.log(`    Output:       ${fmtTokens(stats.totalCompletionTokens)}`);
  console.log(`  Retries:        ${stats.retries}`);
  console.log(`  Errors:         ${stats.errors}`);
  console.log('════════════════════════════════════════════════');
  console.log('');
}

export function printStatsHistory(logDir: string): void {
  const dates = listStatsDates(logDir);
  if (dates.length === 0) {
    console.log('No usage history found');
    return;
  }
  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  Usage History');
  console.log('════════════════════════════════════════════════');
  console.log('  Date         Requests   Tokens');
  for (const date of dates) {
    const stats = loadDailyStats(logDir, date);
    if (!stats) continue;
    const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
    const dateStr = date.padEnd(12);
    const reqStr = String(stats.requestCount).padEnd(10);
    console.log(`  ${dateStr}${reqStr}${fmtTokens(totalTokens)}`);
  }
  console.log('════════════════════════════════════════════════');
  console.log('');
}

export function printSessionSummary(): void {
  const uptime = Date.now() - sessionStats.startTime;
  const totalTokens = sessionStats.totalPromptTokens + sessionStats.totalCompletionTokens;

  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  Session Summary');
  console.log('════════════════════════════════════════════════');
  console.log(`  Requests:       ${sessionStats.requestCount}`);
  console.log(`  Tokens:         ${fmtTokens(totalTokens)}`);
  console.log(`    Input:        ${fmtTokens(sessionStats.totalPromptTokens)}`);
  console.log(`    Output:       ${fmtTokens(sessionStats.totalCompletionTokens)}`);
  console.log(`  Retries:        ${sessionStats.retries}`);
  console.log(`  Errors:         ${sessionStats.errors}`);
  console.log(`  Uptime:         ${fmtUptime(uptime)}`);

  if (dailyStats.date) {
    const totalDailyTokens = dailyStats.totalPromptTokens + dailyStats.totalCompletionTokens;
    console.log('──────────────────────────────────────────────────');
    console.log(`  Today (${dailyStats.date})`);
    console.log(`  Requests:       ${dailyStats.requestCount}`);
    console.log(`  Tokens:         ${fmtTokens(totalDailyTokens)}`);
  }

  console.log('════════════════════════════════════════════════');
  console.log('');
}
