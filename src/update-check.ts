import fs from 'node:fs';
import path from 'node:path';

interface CacheData {
  lastCheck: number;
  latestVersion: string;
}

const CACHE_FILE = '.update-check.json';
// 两次 registry 请求的最小间隔
const CHECK_INTERVAL_MS = 1 * 60 * 60 * 1000;

const REGISTRY_URL = 'https://registry.npmjs.org/maas-coding-proxy/latest';
const FETCH_TIMEOUT_MS = 5000;

/** 读取本地缓存，文件不存在或损坏时返回 null 并删除损坏文件 */
export function readCache(cacheDir: string): CacheData | null {
  const filePath = path.join(cacheDir, CACHE_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as CacheData;
  } catch {
    try { fs.unlinkSync(filePath); } catch { /* 损坏文件删除失败，忽略 */ }
    return null;
  }
}

/** 写入缓存，目录不存在时自动创建，写入失败静默忽略 */
export function writeCache(cacheDir: string, data: CacheData): void {
  const filePath = path.join(cacheDir, CACHE_FILE);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* 缓存写入失败不影响主流程 */ }
}

/** 从 npm registry 获取最新版本号，超时或失败返回 null */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json() as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * 启动时更新检查入口。流程：
 * 1. NO_UPDATE_CHECK 环境变量存在则跳过
 * 2. 缓存未过期则使用缓存版本号，否则请求 registry
 * 3. 发现新版本时输出提示
 */
export async function checkForUpdate(cacheDir: string, currentVersion: string): Promise<void> {
  if (process.env.NO_UPDATE_CHECK) return;

  let latestVersion: string | null = null;
  let shouldFetch = true;

  const cached = readCache(cacheDir);
  if (cached && Date.now() - cached.lastCheck < CHECK_INTERVAL_MS) {
    latestVersion = cached.latestVersion;
    shouldFetch = false;
  }

  if (shouldFetch) {
    const fetched = await fetchLatestVersion();
    if (fetched) {
      latestVersion = fetched;
      writeCache(cacheDir, { lastCheck: Date.now(), latestVersion: fetched });
    } else if (cached) {
      // 网络失败时回退使用缓存版本号，避免丢失已有的更新提示
      latestVersion = cached.latestVersion;
    }
  }

  if (latestVersion && isNewerVersion(currentVersion, latestVersion)) {
    const msg = formatUpdateMessage(currentVersion, latestVersion, !!process.stdout.isTTY);
    console.log(msg);
  }
}

/** 格式化更新提示，TTY 环境下加 ANSI 黄色 */
export function formatUpdateMessage(current: string, latest: string, isTTY: boolean): string {
  const text = `Update available: ${current} → ${latest} (run: npm i -g maas-coding-proxy)`;
  if (!isTTY) return text;
  return `\x1b[33m${text}\x1b[0m`;
}

/**
 * 语义化版本比较，remote > current 时返回 true。
 * 预发布版本（如 0.0.5-beta.4）视为低于同版本号的无后缀版本。
 */
export function isNewerVersion(current: string, remote: string): boolean {
  const parse = (v: string): { parts: number[]; pre: string[] | null } => {
    const [main, preStr] = v.split('-');
    const parts = main.split('.').map((s) => {
      const n = Number(s);
      return isNaN(n) ? 0 : n;
    });
    const pre = preStr ? preStr.split('.') : null;
    return { parts, pre };
  };

  const cur = parse(current);
  const rem = parse(remote);

  for (let i = 0; i < 3; i++) {
    if (rem.parts[i] > cur.parts[i]) return true;
    if (rem.parts[i] < cur.parts[i]) return false;
  }

  // 同 major.minor.patch — 比较预发布标识
  if (cur.pre && !rem.pre) return true;   // 预发布 < 正式版
  if (!cur.pre && rem.pre) return false;   // 正式版 > 预发布
  if (!cur.pre && !rem.pre) return false;  // 完全相等

  // 两者都有预发布标识 — 逐段比较
  for (let i = 0; i < Math.max(cur.pre!.length, rem.pre!.length); i++) {
    const a = cur.pre![i];
    const b = rem.pre![i];
    if (a === undefined && b !== undefined) return true;  // 短标识 < 长标识
    if (a !== undefined && b === undefined) return false;
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) {
      if (numB > numA) return true;
      if (numB < numA) return false;
    } else {
      if (b > a) return true;
      if (b < a) return false;
    }
  }

  return false;
}
