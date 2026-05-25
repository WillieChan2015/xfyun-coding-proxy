import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DailyStats, ProtocolStats } from './stats-store';

// ---- 路径工具函数 ----

export function resolveStatsDir(logDir: string): string {
  return join(logDir, 'stats');
}

export function resolveStatsFile(logDir: string, date: string): string {
  return join(resolveStatsDir(logDir), `${date}.json`);
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

// ---- 合并函数 ----

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
export function mergeDailyStats(a: DailyStats, b: DailyStats): DailyStats {
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

// ---- 加载函数 ----

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

export async function loadDailyStatsAsync(logDir: string, date: string): Promise<DailyStats | null> {
  const file = resolveStatsFile(logDir, date);
  try {
    const content = await readFile(file, 'utf-8');
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

// ---- 保存函数 ----

/** 无条件保存，采用读-改-写：先读取文件已有数据，与内存数据合并后再写入 */
export function saveDailyStatsForce(logDir: string, stats: DailyStats): void {
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

/** 异步版本：避免在请求热路径或定时刷盘中阻塞事件循环 */
export async function saveDailyStatsForceAsync(logDir: string, stats: DailyStats): Promise<void> {
  try {
    const dir = resolveStatsDir(logDir);
    await mkdir(dir, { recursive: true });
    const file = resolveStatsFile(logDir, stats.date);
    const existing = await loadDailyStatsAsync(logDir, stats.date);
    const merged = existing ? mergeDailyStats(existing, stats) : stats;
    await writeFile(file, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save daily stats:', err);
  }
}

// ---- 带脏标记的保存函数（保持原有签名兼容） ----

export function saveDailyStats(
  logDir: string,
  stats: DailyStats,
  currentDailyStats: DailyStats,
  isDailyStatsDirty: () => boolean,
  setDailyStatsDirty: (dirty: boolean) => void,
): void {
  // 当传入的就是全局 dailyStats 时，用脏标记守卫避免无请求时覆写；
  // 当传入外部 stats 对象时（如测试或 rollover），无条件保存
  if (stats === currentDailyStats && !isDailyStatsDirty()) return;
  saveDailyStatsForce(logDir, stats);
  // 同步保存完成后清除脏标记（同步场景不存在并发修改竞态）
  if (stats === currentDailyStats) setDailyStatsDirty(false);
}

export async function saveDailyStatsAsync(
  logDir: string,
  stats: DailyStats,
  currentDailyStats: DailyStats,
  isDailyStatsDirty: () => boolean,
): Promise<void> {
  if (stats === currentDailyStats && !isDailyStatsDirty()) return;
  await saveDailyStatsForceAsync(logDir, stats);
  // 异步保存完成后不清除脏标记：
  // await 期间可能有新请求将 dirty 重置为 true，无条件清除会丢失这些更新；
  // dirty 标记保留到下次定时刷盘，确保新增数据不会遗漏
}

// ---- 列表函数 ----

export function listStatsDates(logDir: string): string[] {
  const dir = resolveStatsDir(logDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map(file => file.replace(/\.json$/, ''))
    .sort((a, b) => b.localeCompare(a));
}
