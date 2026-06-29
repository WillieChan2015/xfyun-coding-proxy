import { EventEmitter } from 'events';
import { loadDailyStats, saveDailyStatsForce } from './stats-persistence';
import { fmtTokens } from './util';
import type {
  SessionDayStats,
  ProtocolStats,
  DailyStats,
  Protocol,
  RequestCompleteEvent,
  RequestLogEntry,
} from './stats-types';

// ---- 会话级统计 ----

// ⚠️ 线程安全说明：sessionStats 和 dailyStats 是模块级可变对象，
// 在 Node.js 单线程事件循环中，对它们的 ++ 和 += 操作不会被中断，因而是安全的。
// 但如果引入 worker_threads 或在同一进程内多次创建 server，这些非原子操作可能导致数据竞争。
// 当前设计仅限单进程单线程使用。
export const sessionStats = {
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalCachedTokens: 0,
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
  sessionStats.totalCachedTokens = 0;
  sessionStats.retries = 0;
  sessionStats.errors = 0;
  sessionStats.startTime = Date.now();
  sessionStats.protocols = {};
  sessionStats.byDate = {};
}

// ---- 每日统计 ----

export const dailyStats: DailyStats = {
  date: '',
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalCachedTokens: 0,
  retries: 0,
  errors: 0,
  protocols: {},
};

// 脏标记：dailyStats 被修改后置 true，避免启动后无请求退出时将加载的数据原样覆写（或加载失败时用全零覆盖已有数据）
let dailyStatsDirty = false;

export function isDailyStatsDirty(): boolean {
  return dailyStatsDirty;
}

export function setDailyStatsDirty(dirty: boolean): void {
  dailyStatsDirty = dirty;
}

export function resetDailyStatsFields(date: string): void {
  dailyStats.date = date;
  dailyStats.requestCount = 0;
  dailyStats.totalPromptTokens = 0;
  dailyStats.totalCompletionTokens = 0;
  dailyStats.totalCachedTokens = 0;
  dailyStats.retries = 0;
  dailyStats.errors = 0;
  dailyStats.protocols = {};
}

// ---- 日期工具函数 ----

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr(): string {
  return formatDate(new Date());
}

// ---- EventEmitter 事件系统 ----

export const statsEmitter = new EventEmitter();
statsEmitter.setMaxListeners(20);

// ---- 请求完成时的日期翻转回调 ----
// 由 server.ts 在启动时通过 setRolloverFn / setSaveFn 注入，避免 stats 模块需要感知 logDir
let rolloverFn: (() => void) | null = null;
let saveFn: ((stats: DailyStats) => void) | null = null;
let rolloverFnSet = false;
let saveFnSet = false;

export function setRolloverFn(fn: (() => void) | null, force = false): void {
  if (rolloverFnSet && fn !== null && !force) {
    console.warn('setRolloverFn: rolloverFn already set, overwriting');
  }
  rolloverFn = fn;
  rolloverFnSet = true;
}

export function setSaveFn(fn: ((stats: DailyStats) => void) | null, force = false): void {
  if (saveFnSet && fn !== null && !force) {
    console.warn('setSaveFn: saveFn already set, overwriting');
  }
  saveFn = fn;
  saveFnSet = true;
}

// ---- 协议统计操作 ----

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
      totalCachedTokens: 0,
      retries: 0,
      errors: 0,
    };
  }
  const p = stats.protocols[protocol];
  if (delta.requestCount !== undefined) p.requestCount += delta.requestCount;
  if (delta.totalPromptTokens !== undefined) p.totalPromptTokens += delta.totalPromptTokens;
  if (delta.totalCompletionTokens !== undefined) p.totalCompletionTokens += delta.totalCompletionTokens;
  if (delta.totalCachedTokens !== undefined) p.totalCachedTokens += delta.totalCachedTokens;
  if (delta.retries !== undefined) p.retries += delta.retries;
  if (delta.errors !== undefined) p.errors += delta.errors;
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

export const LATENCY_WINDOW_SIZE = 1000;

/** 环形缓冲区，避免 Array.shift() 的 O(n) 操作 */
export class RingBuffer<T> {
  private buffer: T[];
  private head = 0;
  private _size = 0;
  private _version = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
    this._version++;
  }

  toArray(): T[] {
    if (this._size < this.capacity) return this.buffer.slice(0, this._size);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  /** 原地查找并更新第一个满足谓词的条目，返回是否找到 */
  updateFirst(predicate: (item: T) => boolean, updater: (item: T) => T): boolean {
    const len = this._size;
    for (let i = 0; i < len; i++) {
      const idx = this._size < this.capacity
        ? i
        : (this.head + i) % this.capacity;
      if (predicate(this.buffer[idx])) {
        this.buffer[idx] = updater(this.buffer[idx]);
        this._version++;
        return true;
      }
    }
    return false;
  }

  get length(): number { return this._size; }
  get version(): number { return this._version; }
}

export const latencyWindow = new RingBuffer<number>(LATENCY_WINDOW_SIZE);

// 缓存排序结果，避免每次调用 getLatencyStats() 都重新排序
let cachedLatencyStats: { avg: number; p95: number } | null = null;
let lastLatencyWindowVersion = -1;

export function getLatencyStats(): { avg: number; p95: number } {
  if (latencyWindow.length === 0) return { avg: 0, p95: 0 };
  if (latencyWindow.version === lastLatencyWindowVersion && cachedLatencyStats) {
    return cachedLatencyStats;
  }
  const sorted = latencyWindow.toArray().sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const p95Idx = Math.ceil(sorted.length * 0.95) - 1;
  cachedLatencyStats = { avg: Math.round(avg), p95: sorted[p95Idx] };
  lastLatencyWindowVersion = latencyWindow.version;
  return cachedLatencyStats;
}

// ---- 请求日志缓冲区（环形） ----

export const LOG_BUFFER_SIZE = 100;
export const requestLog = new RingBuffer<RequestLogEntry>(LOG_BUFFER_SIZE);
// pending 条目原始时间戳：requestId → 请求开始时的 Date.now()
const pendingTimestamps = new Map<string, number>();

export function getRequestLog(): ReadonlyArray<RequestLogEntry> {
  return requestLog.toArray();
}

// ---- 请求记录函数 ----

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

  const { protocol, inputTokens, outputTokens, cachedTokens, success, retries } = event;
  // 静态/探测路由（如 GET /v1/models、/api/version）不计入请求统计
  const countable = event.countable !== false;

  const errorCount = success ? 0 : 1;

  if (countable) {
    dailyStatsDirty = true;

    // 集中更新 sessionStats
    sessionStats.requestCount++;
    sessionStats.totalPromptTokens += inputTokens;
    sessionStats.totalCompletionTokens += outputTokens;
    sessionStats.totalCachedTokens += cachedTokens;
    sessionStats.retries += retries;
    sessionStats.errors += errorCount;

    // 按 session 内的实际完成日归入 byDate（用于跨天分日明细）
    const completionDate = today;
    if (!sessionStats.byDate[completionDate]) {
      sessionStats.byDate[completionDate] = {
        requestCount: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCachedTokens: 0,
        retries: 0,
        errors: 0,
      };
    }
    const dayStats = sessionStats.byDate[completionDate];
    dayStats.requestCount++;
    dayStats.totalPromptTokens += inputTokens;
    dayStats.totalCompletionTokens += outputTokens;
    dayStats.totalCachedTokens += cachedTokens;
    dayStats.retries += retries;
    dayStats.errors += errorCount;

    // 集中更新 dailyStats
    dailyStats.requestCount++;
    dailyStats.totalPromptTokens += inputTokens;
    dailyStats.totalCompletionTokens += outputTokens;
    dailyStats.totalCachedTokens += cachedTokens;
    dailyStats.retries += retries;
    dailyStats.errors += errorCount;

    // 集中更新协议统计
    const protocolDelta = {
      requestCount: 1,
      totalPromptTokens: inputTokens,
      totalCompletionTokens: outputTokens,
      totalCachedTokens: cachedTokens,
      retries,
      errors: errorCount,
    };
    incrementProtocolStats(sessionStats, protocol, protocolDelta);
    incrementProtocolStats(dailyStats, protocol, protocolDelta);
  }

  // 发射事件
  statsEmitter.emit('request:complete', event);

  // 延迟窗口：推入延迟值，RingBuffer 会自动处理溢出
  latencyWindow.push(event.latencyMs);

  // 请求日志缓冲区：查找并原地更新 pending 条目，或新增
  const pendingTs = event.requestId ? pendingTimestamps.get(event.requestId) : undefined;
  if (event.requestId && pendingTs !== undefined) {
    pendingTimestamps.delete(event.requestId);
  }

  const updated = event.requestId
    ? requestLog.updateFirst(
        (e) => e.pending === true && e.requestId === event.requestId,
        (e) => ({
          ...e,
          timestamp: pendingTs ?? e.timestamp,
          latencyMs: event.latencyMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedTokens: event.cachedTokens,
          success: event.success,
          pending: false,
          ...(event.stream !== undefined ? { stream: event.stream } : {}),
          ...(event.ua ? { ua: event.ua } : {}),
          ...(event.error ? { error: event.error } : {}),
        }),
      )
    : false;

  if (!updated) {
    const logEntry: RequestLogEntry = {
      timestamp: pendingTs ?? Date.now(),
      method: event.method ?? 'POST',
      path: event.path ?? `/${event.protocol}`,
      protocol: event.protocol,
      model: event.model,
      latencyMs: event.latencyMs,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedTokens: event.cachedTokens,
      success: event.success,
      ...(event.stream !== undefined ? { stream: event.stream } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.ua ? { ua: event.ua } : {}),
      ...(event.error ? { error: event.error } : {}),
    };
    requestLog.push(logEntry);
  }
}

/**
 * 记录请求开始事件：推入 pending 日志条目 + 发射事件
 */
export function recordRequestStart(protocol: Protocol, model: string, requestId?: string, path?: string, ua?: string, stream?: boolean): void {
  const now = Date.now();
  const entry: RequestLogEntry = {
    timestamp: now,
    method: 'POST',
    path: path ?? `/${protocol}`,
    protocol,
    model,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    success: true,
    ...(stream !== undefined ? { stream } : {}),
    pending: true,
    ...(requestId ? { requestId } : {}),
    ...(ua ? { ua } : {}),
  };
  requestLog.push(entry);
  if (requestId) {
    pendingTimestamps.set(requestId, now);
  }
  statsEmitter.emit('request:start', { protocol, model, requestId });
}

// ---- 每日统计操作 ----

/**
 * 检查日期是否翻转，若跨天则将旧数据持久化并重置 dailyStats 为新一天
 * 在每次请求入口和定时刷盘时调用
 */
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

export function resetDailyStats(): void {
  // 重置前先保存当前数据，避免 rollover 时用全零覆写已有数据
  if (saveFn && dailyStatsDirty && dailyStats.date) {
    saveFn(dailyStats);
    dailyStatsDirty = false;
  }
  resetDailyStatsFields(todayStr());
  dailyStatsDirty = true;
}

// ---- 格式化工具函数（用于 display 模块） ----

export function formatStatsLine(
  label: string,
  stats: { requestCount: number; totalPromptTokens: number; totalCompletionTokens: number; totalCachedTokens?: number; errors?: number },
  labelWidth: number = 14,
): string {
  const errSuffix = (stats.errors ?? 0) > 0 ? `  ${stats.errors} err` : '';
  const cachedSuffix = `  +${fmtTokens(stats.totalCachedTokens ?? 0)} cached`;
  return `    ${label.padEnd(labelWidth)}${String(stats.requestCount).padStart(5)} req  ${fmtTokens(stats.totalPromptTokens).padStart(10)} in  ${fmtTokens(stats.totalCompletionTokens).padStart(10)} out${cachedSuffix}${errSuffix}`;
}
