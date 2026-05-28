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
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';

/** debug 模式缓存 — config 初始化后读取一次，resetDebugLogger 用于测试重置 */
let _enabled: boolean | undefined;
let _logDir: string | undefined;

export function resetDebugLogger(): void {
  _enabled = undefined;
  _logDir = undefined;
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

/** 获取当天日志文件路径 */
function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
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
