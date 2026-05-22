import { fmtTokens } from './util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'events';

export interface SessionDayStats {
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
}

// ⚠️ 线程安全说明：sessionStats 和 dailyStats 是模块级可变对象，
// 在 Node.js 单线程事件循环中，对它们的 ++ 和 += 操作不会被中断，因而是安全的。
// 但如果引入 worker_threads 或在同一进程内多次创建 server，这些非原子操作可能导致数据竞争。
// 当前设计仅限单进程单线程使用。
export const sessionStats = {
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  retries: 0,
  errors: 0,
  startTime: Date.now(),
  protocols: {} as Record<string, ProtocolStats>,
  byDate: {} as Record<string, SessionDayStats>,
};

export function resetSessionStats(): void {
  sessionStats.requestCount = 0;
  sessionStats.totalPromptTokens = 0;
  sessionStats.totalCompletionTokens = 0;
  sessionStats.retries = 0;
  sessionStats.errors = 0;
  sessionStats.startTime = Date.now();
  sessionStats.protocols = {};
  sessionStats.byDate = {};
}

function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const days = Math.floor(hr / 24);
  return `${days}d ${hr % 24}h ${min % 60}m`;
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

// 脏标记：dailyStats 被修改后置 true，避免启动后无请求退出时将加载的数据原样覆写（或加载失败时用全零覆盖已有数据）
let dailyStatsDirty = false;

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatStatsLine(
  label: string,
  stats: { requestCount: number; totalPromptTokens: number; totalCompletionTokens: number; errors?: number },
  labelWidth: number = 14,
): string {
  const errSuffix = (stats.errors ?? 0) > 0 ? `  ${stats.errors} err` : '';
  return `    ${label.padEnd(labelWidth)}${String(stats.requestCount).padStart(5)} req  ${fmtTokens(stats.totalPromptTokens).padStart(10)} in  ${fmtTokens(stats.totalCompletionTokens).padStart(10)} out${errSuffix}`;
}

export function todayStr(): string {
  return formatDate(new Date());
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
  // 当传入的就是全局 dailyStats 时，用脏标记守卫避免无请求时覆写；
  // 当传入外部 stats 对象时（如测试或 rollover），无条件保存
  if (stats === dailyStats && !dailyStatsDirty) return;
  saveDailyStatsForce(logDir, stats);
  dailyStatsDirty = false;
}

/** 合并两组协议统计，各字段取较大值（防止多进程/外部恢复时覆写丢失数据） */
function mergeProtocolStats(
  a: Record<string, ProtocolStats>,
  b: Record<string, ProtocolStats>,
): Record<string, ProtocolStats> {
  const result: Record<string, ProtocolStats> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const pa = a[key] ?? { requestCount: 0, totalPromptTokens: 0, totalCompletionTokens: 0, retries: 0, errors: 0 };
    const pb = b[key] ?? { requestCount: 0, totalPromptTokens: 0, totalCompletionTokens: 0, retries: 0, errors: 0 };
    result[key] = {
      requestCount: Math.max(pa.requestCount, pb.requestCount),
      totalPromptTokens: Math.max(pa.totalPromptTokens, pb.totalPromptTokens),
      totalCompletionTokens: Math.max(pa.totalCompletionTokens, pb.totalCompletionTokens),
      retries: Math.max(pa.retries, pb.retries),
      errors: Math.max(pa.errors, pb.errors),
    };
  }
  return result;
}

/** 合并两组每日统计，各数值字段取较大值 */
function mergeDailyStats(a: DailyStats, b: DailyStats): DailyStats {
  return {
    date: a.date,
    requestCount: Math.max(a.requestCount, b.requestCount),
    totalPromptTokens: Math.max(a.totalPromptTokens, b.totalPromptTokens),
    totalCompletionTokens: Math.max(a.totalCompletionTokens, b.totalCompletionTokens),
    retries: Math.max(a.retries, b.retries),
    errors: Math.max(a.errors, b.errors),
    protocols: mergeProtocolStats(a.protocols, b.protocols),
  };
}

/** 无条件保存，采用读-改-写：先读取文件已有数据，与内存数据合并后再写入 */
function saveDailyStatsForce(logDir: string, stats: DailyStats): void {
  try {
    const dir = resolveStatsDir(logDir);
    mkdirSync(dir, { recursive: true });
    const file = resolveStatsFile(logDir, stats.date);
    // 读-改-写：合并文件中已有数据，防止多进程并发写入或外部恢复数据被覆写
    const existing = loadDailyStats(logDir, stats.date);
    const merged = existing ? mergeDailyStats(existing, stats) : stats;
    writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save daily stats:', err);
  }
}

/**
 * 检查日期是否翻转，若跨天则将旧数据持久化并重置 dailyStats 为新一天
 * 在每次请求入口和定时刷盘时调用
 */
function resetDailyStatsFields(date: string): void {
  dailyStats.date = date;
  dailyStats.requestCount = 0;
  dailyStats.totalPromptTokens = 0;
  dailyStats.totalCompletionTokens = 0;
  dailyStats.retries = 0;
  dailyStats.errors = 0;
  dailyStats.protocols = {};
}

export function rolloverDailyStats(logDir: string): void {
  const today = todayStr();
  if (dailyStats.date === today) return;

  // 跨天：无条件保存旧日期数据（确保完整写入），然后重置
  if (dailyStats.date) {
    saveDailyStatsForce(logDir, dailyStats);
  }

  // 重置为新一天
  const existing = loadDailyStats(logDir, today);
  if (existing) {
    Object.assign(dailyStats, existing);
  } else {
    resetDailyStatsFields(today);
  }
  dailyStatsDirty = false;
}

export function initDailyStats(logDir: string): void {
  const today = todayStr();
  const existing = loadDailyStats(logDir, today);
  if (existing) {
    Object.assign(dailyStats, existing);
  } else {
    resetDailyStatsFields(today);
  }
  dailyStatsDirty = false;
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
  if (delta.requestCount !== undefined) p.requestCount += delta.requestCount;
  if (delta.totalPromptTokens !== undefined) p.totalPromptTokens += delta.totalPromptTokens;
  if (delta.totalCompletionTokens !== undefined) p.totalCompletionTokens += delta.totalCompletionTokens;
  if (delta.retries !== undefined) p.retries += delta.retries;
  if (delta.errors !== undefined) p.errors += delta.errors;
}

// ---- EventEmitter 事件系统 ----

export const statsEmitter = new EventEmitter();
statsEmitter.setMaxListeners(20);

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

// ---- 请求完成时的日期翻转回调 ----
// 由 server.ts 在启动时通过 setRolloverFn / setSaveFn 注入，避免 stats 模块需要感知 logDir
let rolloverFn: (() => void) | null = null;
let saveFn: ((stats: DailyStats) => void) | null = null;

export function setRolloverFn(fn: (() => void) | null): void {
  rolloverFn = fn;
}

export function setSaveFn(fn: ((stats: DailyStats) => void) | null): void {
  saveFn = fn;
}

/**
 * 集中记录请求完成事件：更新 sessionStats/dailyStats + 协议统计 + 发射事件
 * 替代各 handler 中分散的 sessionStats.xxx++ / dailyStats.xxx++ / incrementProtocolStats() 调用
 */
export function recordRequestComplete(event: RequestCompleteEvent): void {
  // 请求跨天完成时（入口在旧日、出口在新日），先触发日期翻转
  // 确保 dailyStats 累加到正确的日期，而非归入旧日
  const today = todayStr();
  if (dailyStats.date !== today && rolloverFn) {
    rolloverFn();
  }

  dailyStatsDirty = true;
  const { protocol, inputTokens, outputTokens, success, retries } = event;

  const errorCount = success ? 0 : 1;

  // 集中更新 sessionStats
  sessionStats.requestCount++;
  sessionStats.totalPromptTokens += inputTokens;
  sessionStats.totalCompletionTokens += outputTokens;
  sessionStats.retries += retries;
  sessionStats.errors += errorCount;

  // 按 session 内的实际完成日归入 byDate（用于跨天分日明细）
  const completionDate = today;
  if (!sessionStats.byDate[completionDate]) {
    sessionStats.byDate[completionDate] = {
      requestCount: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      retries: 0,
      errors: 0,
    };
  }
  const dayStats = sessionStats.byDate[completionDate];
  dayStats.requestCount++;
  dayStats.totalPromptTokens += inputTokens;
  dayStats.totalCompletionTokens += outputTokens;
  dayStats.retries += retries;
  dayStats.errors += errorCount;

  // 集中更新 dailyStats
  dailyStats.requestCount++;
  dailyStats.totalPromptTokens += inputTokens;
  dailyStats.totalCompletionTokens += outputTokens;
  dailyStats.retries += retries;
  dailyStats.errors += errorCount;

  // 集中更新协议统计
  const protocolDelta = {
    requestCount: 1,
    totalPromptTokens: inputTokens,
    totalCompletionTokens: outputTokens,
    retries,
    errors: errorCount,
  };
  incrementProtocolStats(sessionStats, protocol, protocolDelta);
  incrementProtocolStats(dailyStats, protocol, protocolDelta);

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
  // 重置前先保存当前数据，避免 rollover 时用全零覆写已有数据
  if (saveFn && dailyStatsDirty && dailyStats.date) {
    saveFn(dailyStats);
    dailyStatsDirty = false;
  }
  resetDailyStatsFields(todayStr());
  dailyStatsDirty = true;
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
      console.log(formatStatsLine(name, p));
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
  const startDateStr = formatDate(new Date(sessionStats.startTime));
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

  // By Day 分日明细（跨天时展示每日贡献）
  const byDateKeys = Object.keys(sessionStats.byDate).sort();
  if (byDateKeys.length > 1) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Day:');
    for (const date of byDateKeys) {
      const d = sessionStats.byDate[date];
      console.log(formatStatsLine(date, d, 10));
    }
  }

  const sessionProtocolKeys = Object.keys(sessionStats.protocols);
  if (sessionProtocolKeys.length > 0) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Protocol:');
    const sorted = sessionProtocolKeys.sort((a, b) => sessionStats.protocols[b].requestCount - sessionStats.protocols[a].requestCount);
    for (const name of sorted) {
      const p = sessionStats.protocols[name];
      console.log(formatStatsLine(name, p));
    }
  }

  // Today 部分：仅单日运行且有实际数据时展示；
  // 跨天时 By Day 已包含今天的明细，Today 的 cumulative 语义（含历史实例数据）容易混淆，故隐藏
  if (byDateKeys.length <= 1 && dailyStats.date && dailyStats.requestCount > 0) {
    const totalDailyTokens = dailyStats.totalPromptTokens + dailyStats.totalCompletionTokens;
    console.log('──────────────────────────────────────────────────');
    console.log(`  Today (${dailyStats.date})`);
    console.log(`  Requests:       ${dailyStats.requestCount}`);
    console.log(`  Tokens:         ${fmtTokens(totalDailyTokens)}`);
    console.log(`    Input:        ${fmtTokens(dailyStats.totalPromptTokens)}`);
    console.log(`    Output:       ${fmtTokens(dailyStats.totalCompletionTokens)}`);
    console.log(`  Retries:        ${dailyStats.retries}`);
    console.log(`  Errors:         ${dailyStats.errors}`);
    const todayProtocolKeys = Object.keys(dailyStats.protocols);
    if (todayProtocolKeys.length > 0) {
      console.log('    By Protocol:');
      const sorted = todayProtocolKeys.sort((a, b) => dailyStats.protocols[b].requestCount - dailyStats.protocols[a].requestCount);
      for (const name of sorted) {
        const p = dailyStats.protocols[name];
        console.log(formatStatsLine(name, p));
      }
    }
  }

  console.log('════════════════════════════════════════════════');
  console.log('');
}
