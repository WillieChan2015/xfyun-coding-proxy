/**
 * Debug 日志模块
 *
 * 开启条件：config.debug = true（CLI --debug 或 DEBUG_PROXY=1）
 * 输出格式：NDJSON（每行一个 JSON 对象），写入 logs/debug/YYYY-MM-DD.ndjson
 * 日志类型：request（客户端请求）、upstream（上游响应）、response（代理返回给客户端）
 *
 * 注意：debug 日志包含完整的请求/响应 body（含 headers），仅用于排查问题，
 * 生产环境不应长期开启。Authorization header 已在 pino 日志中脱敏，
 * debug 日志中保留原始值以便排查认证问题。
 */
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';

/** debug 模式缓存 — config 初始化后读取一次，resetDebugLogger 用于测试重置 */
let _enabled: boolean | undefined;
let _logDir: string | undefined;

export function resetDebugLogger(): void {
  _enabled = undefined;
  _logDir = undefined;
  _lastLogDate = undefined;
}

/** 判断 debug 模式是否开启 */
export function isDebugEnabled(): boolean {
  if (_enabled === undefined) {
    // 测试环境可通过 DEBUG_FORCE=1 绕过 config（config 可能未初始化）
    _enabled = process.env.DEBUG_FORCE === '1' || config.debug;
  }
  return _enabled;
}

/** debug 日志目录：默认 {logDir}/debug/，可通过 DEBUG_LOG_DIR 覆盖（测试用） */
function getDebugLogDir(): string {
  if (_logDir === undefined) {
    _logDir = process.env.DEBUG_LOG_DIR ?? join(config.logDir, 'debug');
    mkdirSync(_logDir, { recursive: true });
  }
  return _logDir;
}

/** 上次写入的日期（YYYY-MM-DD），用于检测跨天时触发一次日志清理 */
let _lastLogDate: string | undefined;

/** 获取当天日志文件路径；跨天时顺带清理一次超期日志（每日仅触发一次） */
function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  // 日期翻新：当天首条日志写入前清理超期文件，避免文件无限累积
  if (_lastLogDate !== date) {
    _lastLogDate = date;
    cleanupOldDebugLogs();
  }
  return join(getDebugLogDir(), `${date}.ndjson`);
}

/** 追加一行 NDJSON */
function writeLine(record: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  const line = JSON.stringify(record) + '\n';
  try {
    appendFileSync(getLogFilePath(), line, 'utf-8');
  } catch {
    // 文件写入失败不应影响正常请求处理
  }
}

/** 记录客户端请求 */
export function debugLogRequest(
  reqId: string,
  data: { method: string; url: string; headers?: Record<string, string | undefined>; body?: unknown },
): void {
  writeLine({ ts: new Date().toISOString(), reqId, type: 'request', data });
}

/** 记录代理返回给客户端的响应 */
export function debugLogResponse(
  reqId: string,
  data: { statusCode: number; headers?: Record<string, string | string[] | undefined>; bodyChunks?: string[] },
): void {
  writeLine({ ts: new Date().toISOString(), reqId, type: 'response', data });
}

/** 记录上游（讯飞）返回的响应 */
export function debugLogUpstream(
  reqId: string,
  data: { statusCode: number; headers?: Record<string, string | string[] | undefined>; bodyChunks?: string[] },
): void {
  writeLine({ ts: new Date().toISOString(), reqId, type: 'upstream', data });
}

/**
 * debug 日志保留天数：默认 7 天，可通过 DEBUG_RETENTION_DAYS 覆盖。
 * 非数字、负数或 0 视为无效，回退到默认值。
 */
function getRetentionDays(): number {
  const raw = process.env.DEBUG_RETENTION_DAYS;
  const n = raw === undefined ? NaN : Number(raw);
  // 非法值回退默认 7 天，避免误删或保留过久
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.floor(n);
}

/**
 * 清理超过保留天数的 debug 日志文件。
 * 按文件名日期（YYYY-MM-DD.ndjson）判断，早于「今天 - 保留天数」的文件删除。
 * 仅匹配严格日期前缀的 .ndjson 文件，非日志文件（如 readme）不受影响。
 * 清理失败不影响请求流程，静默返回已删除数量。
 * @returns 实际删除的文件数
 */
export function cleanupOldDebugLogs(): number {
  const dir = getDebugLogDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // 目录不存在或读取失败，无文件可清，返回 0
    return 0;
  }
  // 以 UTC 当天 00:00 为基准减保留天数，与文件名日期（UTC）对齐，
  // 确保边界文件（恰好 N 天前）被保留而非误删
  const todayUTC = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(`${todayUTC}T00:00:00.000Z`).getTime() - getRetentionDays() * 24 * 60 * 60 * 1000;
  const dateRe = /^(\d{4})-(\d{2})-(\d{2})\.ndjson$/;
  let deleted = 0;
  for (const name of names) {
    const m = dateRe.exec(name);
    if (!m) continue; // 非严格日期命名文件，跳过
    // 与日志文件名同源（UTC 日期）对齐到当天 00:00，避免时分秒导致边界文件误删
    const fileTime = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`).getTime();
    if (Number.isNaN(fileTime) || fileTime >= cutoff) continue;
    try {
      unlinkSync(join(dir, name));
      deleted++;
    } catch {
      // 单文件删除失败跳过，继续处理其余文件
    }
  }
  return deleted;
}
