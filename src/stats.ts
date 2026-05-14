import { fmtTokens } from './util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'events';

export const sessionStats = {
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  retries: 0,
  errors: 0,
  startTime: Date.now(),
  protocols: {} as Record<string, ProtocolStats>,
};

function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export interface ProtocolStats {
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
}

export interface DailyStats {
  date: string;
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
  protocols: Record<string, ProtocolStats>;
}

export const dailyStats: DailyStats = {
  date: '',
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  retries: 0,
  errors: 0,
  protocols: {},
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
      if (!parsed.protocols) {
        parsed.protocols = {};
      }
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

/**
 * 检查日期是否翻转，若跨天则将旧数据持久化并重置 dailyStats 为新一天
 * 在每次请求入口和定时刷盘时调用
 */
export function rolloverDailyStats(logDir: string): void {
  const today = todayStr();
  if (dailyStats.date === today) return;

  // 先持久化旧日期的数据
  if (dailyStats.date) {
    saveDailyStats(logDir, dailyStats);
  }

  // 重置为新一天
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
    dailyStats.protocols = {};
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
    dailyStats.protocols = {};
  }
}

export function incrementProtocolStats(
  stats: { protocols: Record<string, ProtocolStats> },
  protocol: string,
  delta: Partial<ProtocolStats>,
): void {
  if (!stats.protocols[protocol]) {
    stats.protocols[protocol] = {
      requestCount: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
    };
  }
  const p = stats.protocols[protocol];
  if (delta.requestCount) p.requestCount += delta.requestCount;
  if (delta.totalPromptTokens) p.totalPromptTokens += delta.totalPromptTokens;
  if (delta.totalCompletionTokens) p.totalCompletionTokens += delta.totalCompletionTokens;
  if (delta.retries) p.retries += delta.retries;
  if (delta.errors) p.errors += delta.errors;
}

// ---- EventEmitter 事件系统 ----

export const statsEmitter = new EventEmitter();

export type Protocol = 'openai' | 'anthropic' | 'ollama';

export interface RequestCompleteEvent {
  protocol: Protocol;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  retries: number;
  stream?: boolean;
  requestId?: string;
  path?: string;
  ua?: string;
  error?: string;
}

/**
 * 集中记录请求完成事件：更新 sessionStats/dailyStats + 协议统计 + 发射事件
 * 替代各 handler 中分散的 sessionStats.xxx++ / dailyStats.xxx++ / incrementProtocolStats() 调用
 */
export function recordRequestComplete(event: RequestCompleteEvent): void {
  const { protocol, inputTokens, outputTokens, success, retries } = event;

  // 集中更新 sessionStats
  sessionStats.requestCount++;
  sessionStats.totalPromptTokens += inputTokens;
  sessionStats.totalCompletionTokens += outputTokens;
  sessionStats.retries += retries;
  if (!success) sessionStats.errors++;

  // 集中更新 dailyStats
  dailyStats.requestCount++;
  dailyStats.totalPromptTokens += inputTokens;
  dailyStats.totalCompletionTokens += outputTokens;
  dailyStats.retries += retries;
  if (!success) dailyStats.errors++;

  // 集中更新协议统计
  incrementProtocolStats(sessionStats, protocol, {
    requestCount: 1,
    totalPromptTokens: inputTokens,
    totalCompletionTokens: outputTokens,
    retries,
    ...(success ? {} : { errors: 1 }),
  });
  incrementProtocolStats(dailyStats, protocol, {
    requestCount: 1,
    totalPromptTokens: inputTokens,
    totalCompletionTokens: outputTokens,
    retries,
    ...(success ? {} : { errors: 1 }),
  });

  // 发射事件
  statsEmitter.emit('request:complete', event);

  // 延迟窗口：推入延迟值，超出窗口大小时移除最早的数据
  latencyWindow.push(event.latencyMs);
  if (latencyWindow.length > LATENCY_WINDOW_SIZE) {
    latencyWindow.shift();
  }

  // 请求日志缓冲区：查找并更新 pending 条目，或新增
  const pendingIdx = event.requestId
    ? requestLog.findIndex(e => e.pending && e.requestId === event.requestId)
    : -1;

  const logEntry: RequestLogEntry = {
    timestamp: pendingIdx >= 0 ? requestLog[pendingIdx].timestamp : Date.now(),
    method: 'POST',
    path: event.path ?? `/${event.protocol}`,
    protocol: event.protocol,
    model: event.model,
    latencyMs: event.latencyMs,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    success: event.success,
    ...(event.stream !== undefined ? { stream: event.stream } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.ua ? { ua: event.ua } : {}),
    ...(event.error ? { error: event.error } : {}),
  };

  if (pendingIdx >= 0) {
    requestLog[pendingIdx] = logEntry;
  } else {
    requestLog.push(logEntry);
    if (requestLog.length > LOG_BUFFER_SIZE) {
      requestLog.shift();
    }
  }
}

/**
 * 记录请求开始事件：推入 pending 日志条目 + 发射事件
 */
export function recordRequestStart(protocol: Protocol, model: string, requestId?: string, path?: string, ua?: string, stream?: boolean): void {
  const entry: RequestLogEntry = {
    timestamp: Date.now(),
    method: 'POST',
    path: path ?? `/${protocol}`,
    protocol,
    model,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    success: true,
    ...(stream !== undefined ? { stream } : {}),
    pending: true,
    ...(requestId ? { requestId } : {}),
    ...(ua ? { ua } : {}),
  };
  requestLog.push(entry);
  if (requestLog.length > LOG_BUFFER_SIZE) {
    requestLog.shift();
  }
  statsEmitter.emit('request:start', { protocol, model, requestId });
}

// ---- 并发追踪 ----

let activeRequests = 0;
let streamingRequests = 0;

export function requestStarted(): void {
  activeRequests++;
}

export function requestFinished(): void {
  activeRequests = Math.max(0, activeRequests - 1);
}

export function streamingStarted(): void {
  streamingRequests++;
}

export function streamingFinished(): void {
  streamingRequests = Math.max(0, streamingRequests - 1);
}

export function getActiveRequests(): number {
  return activeRequests;
}

export function getStreamingRequests(): number {
  return streamingRequests;
}

// ---- 延迟追踪（滑动窗口） ----

const LATENCY_WINDOW_SIZE = 1000;
const latencyWindow: number[] = [];

export function getLatencyStats(): { avg: number; p95: number } {
  if (latencyWindow.length === 0) return { avg: 0, p95: 0 };
  const sorted = [...latencyWindow].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const p95Idx = Math.ceil(sorted.length * 0.95) - 1;
  return { avg: Math.round(avg), p95: sorted[p95Idx] };
}

// ---- 请求日志缓冲区（环形） ----

export interface RequestLogEntry {
  timestamp: number;
  method: string;
  path: string;
  protocol: Protocol;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  stream?: boolean;
  pending?: boolean;
  requestId?: string;
  ua?: string;
  error?: string;
}

const LOG_BUFFER_SIZE = 100;
const requestLog: RequestLogEntry[] = [];

export function getRequestLog(): ReadonlyArray<RequestLogEntry> {
  return requestLog;
}

export function resetDailyStats(): void {
  dailyStats.date = todayStr();
  dailyStats.requestCount = 0;
  dailyStats.totalPromptTokens = 0;
  dailyStats.totalCompletionTokens = 0;
  dailyStats.retries = 0;
  dailyStats.errors = 0;
  dailyStats.protocols = {};
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
  const protocolKeys = Object.keys(stats.protocols);
  if (protocolKeys.length > 0) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Protocol:');
    const sorted = protocolKeys.sort((a, b) => stats.protocols[b].requestCount - stats.protocols[a].requestCount);
    for (const name of sorted) {
      const p = stats.protocols[name];
      const totalTok = p.totalPromptTokens + p.totalCompletionTokens;
      console.log(`    ${name.padEnd(14)}${String(p.requestCount).padStart(5)} req   ${fmtTokens(totalTok).padStart(14)} tok   ${String(p.errors).padStart(1)} err`);
    }
  }
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
  console.log('  Date         Requests   Tokens              Protocols');
  for (const date of dates) {
    const stats = loadDailyStats(logDir, date);
    if (!stats) continue;
    const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
    const dateStr = date.padEnd(12);
    const reqStr = String(stats.requestCount).padEnd(10);
    const tokStr = fmtTokens(totalTokens).padEnd(20);
    const protocolKeys = Object.keys(stats.protocols);
    const protocolsStr = protocolKeys.length > 0
      ? protocolKeys.sort((a, b) => stats.protocols[b].requestCount - stats.protocols[a].requestCount)
          .map(name => `${name}(${stats.protocols[name].requestCount})`)
          .join(' ')
      : '-';
    console.log(`  ${dateStr}${reqStr}${tokStr}${protocolsStr}`);
  }
  console.log('════════════════════════════════════════════════');
  console.log('');
}

export function printSessionSummary(): void {
  const uptime = Date.now() - sessionStats.startTime;
  const totalTokens = sessionStats.totalPromptTokens + sessionStats.totalCompletionTokens;
  const startDate = new Date(sessionStats.startTime);
  const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
  const today = todayStr();
  const dateRange = startDateStr === today ? startDateStr : `${startDateStr} ~ ${today}`;

  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  Session Summary');
  console.log('════════════════════════════════════════════════');
  console.log(`  Date:           ${dateRange}`);
  console.log(`  Requests:       ${sessionStats.requestCount}`);
  console.log(`  Tokens:         ${fmtTokens(totalTokens)}`);
  console.log(`    Input:        ${fmtTokens(sessionStats.totalPromptTokens)}`);
  console.log(`    Output:       ${fmtTokens(sessionStats.totalCompletionTokens)}`);
  console.log(`  Retries:        ${sessionStats.retries}`);
  console.log(`  Errors:         ${sessionStats.errors}`);
  console.log(`  Uptime:         ${fmtUptime(uptime)}`);

  const sessionProtocolKeys = Object.keys(sessionStats.protocols);
  if (sessionProtocolKeys.length > 0) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Protocol:');
    const sorted = sessionProtocolKeys.sort((a, b) => sessionStats.protocols[b].requestCount - sessionStats.protocols[a].requestCount);
    for (const name of sorted) {
      const p = sessionStats.protocols[name];
      const totalTok = p.totalPromptTokens + p.totalCompletionTokens;
      console.log(`    ${name.padEnd(14)}${String(p.requestCount).padStart(5)} req   ${fmtTokens(totalTok).padStart(14)} tok   ${String(p.errors).padStart(1)} err`);
    }
  }

  if (dailyStats.date) {
    const totalDailyTokens = dailyStats.totalPromptTokens + dailyStats.totalCompletionTokens;
    console.log('──────────────────────────────────────────────────');
    console.log(`  Today (${dailyStats.date})`);
    console.log(`  Requests:       ${dailyStats.requestCount}`);
    console.log(`  Tokens:         ${fmtTokens(totalDailyTokens)}`);
    const todayProtocolKeys = Object.keys(dailyStats.protocols);
    if (todayProtocolKeys.length > 0) {
      const sorted = todayProtocolKeys.sort((a, b) => dailyStats.protocols[b].requestCount - dailyStats.protocols[a].requestCount);
      for (const name of sorted) {
        const p = dailyStats.protocols[name];
        const totalTok = p.totalPromptTokens + p.totalCompletionTokens;
        console.log(`    ${name.padEnd(14)}${String(p.requestCount).padStart(5)} req   ${fmtTokens(totalTok).padStart(14)} tok   ${String(p.errors).padStart(1)} err`);
      }
    }
  }

  console.log('════════════════════════════════════════════════');
  console.log('');
}
