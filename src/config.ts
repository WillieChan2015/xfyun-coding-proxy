import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { CliOptions } from './cli';

/** 代理强制覆盖的模型 ID，所有协议路由统一使用 */
export const DEFAULT_MODEL = 'astron-code-latest';

export interface ResolvedConfig {
  port: number;
  apiKey: string;
  baseUrl: string;
  anthropicBaseUrl: string;
  maxRetries: number;
  retryDelay: number;
  verbose: boolean;
  logDir: string;
  statsDir: string;
  statsFlushInterval: number;
  /** 实际加载的配置文件路径，未找到时为 undefined */
  configFile?: string;
}

// 模块级 config：loadConfig() 调用后赋值，proxy.ts 等通过 import { config } 读取
// 初始值提供合理默认，避免测试中 import 时为 undefined
export let config: ResolvedConfig = {
  port: 3000,
  apiKey: '',
  baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
  anthropicBaseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic',
  maxRetries: 3,
  retryDelay: 1000,
  verbose: false,
  logDir: './logs',
  statsDir: './logs/stats',
  statsFlushInterval: 60_000,
  configFile: undefined,
};

/**
 * 按优先级查找配置文件：
 * 1. --config CLI flag / $MAAS_CODING_PROXY_CONFIG
 * 2. $XDG_CONFIG_HOME/maas-coding-proxy/config.env（兼容旧目录 ~/.config/xfyun-coding-proxy/config.env）
 * 3. CWD 下的 .env
 */
export function resolveEnvFile(configPath?: string): string | undefined {
  const explicit = configPath || process.env.MAAS_CODING_PROXY_CONFIG;
  if (explicit && existsSync(explicit)) return resolve(explicit);

  const xdgHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const xdgPaths = [
    join(xdgHome, 'maas-coding-proxy', 'config.env'),
    // 兼容旧包名对应的全局配置目录，避免改名后要求用户立即迁移本地配置文件。
    join(xdgHome, 'xfyun-coding-proxy', 'config.env'),
  ];
  for (const xdgPath of xdgPaths) {
    if (existsSync(xdgPath)) return xdgPath;
  }

  const cwdEnv = join(process.cwd(), '.env');
  if (existsSync(cwdEnv)) return cwdEnv;

  return undefined;
}

/**
 * 按优先级确定日志目录：
 * 1. --log-dir CLI flag
 * 2. $XFYUN_LOG_DIR 环境变量
 * 3. CWD 下存在 package.json → ./logs（源码开发调试）
 * 4. $XDG_STATE_HOME/maas-coding-proxy/logs（回退 ~/.local/state/maas-coding-proxy/logs）
 */
export function resolveLogDir(cliLogDir?: string): string {
  if (cliLogDir) return resolve(cliLogDir);

  const envLogDir = process.env.XFYUN_LOG_DIR;
  if (envLogDir) return resolve(envLogDir);

  if (existsSync(join(process.cwd(), 'package.json'))) {
    return join(process.cwd(), 'logs');
  }

  const xdgState = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(xdgState, 'maas-coding-proxy', 'logs');
}

/**
 * 加载并合并配置：CLI flags > env vars > 配置文件 > 默认值
 * 调用后更新模块级 config，供 proxy.ts 等直接引用
 */
export function loadConfig(cliOpts: CliOptions): ResolvedConfig {
  // 先加载 .env 文件，使 process.env 中的值可用于后续合并
  const envFile = resolveEnvFile(cliOpts.config);
  if (envFile) dotenv.config({ path: envFile });

  const resolved: ResolvedConfig = {
    port: cliOpts.port ?? parseInt(process.env.PORT || '3000', 10),
    apiKey: cliOpts.apiKey ?? process.env.XFYUN_API_KEY ?? '',
    baseUrl:
      cliOpts.baseUrl ??
      process.env.XFYUN_BASE_URL ??
      'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
    anthropicBaseUrl:
      cliOpts.anthropicBaseUrl ??
      process.env.XFYUN_ANTHROPIC_BASE_URL ??
      'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic',
    maxRetries: cliOpts.maxRetries ?? parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelay: cliOpts.retryDelay ?? parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
    verbose: cliOpts.verbose ?? process.env.VERBOSE === 'true',
    logDir: resolveLogDir(cliOpts.logDir),
    statsDir: join(resolveLogDir(cliOpts.logDir), 'stats'),
    statsFlushInterval: parseInt(process.env.STATS_FLUSH_INTERVAL_MS || '60000', 10),
    configFile: envFile,
  };

  config = resolved;
  return resolved;
}

export function validateConfig(cfg?: ResolvedConfig): void {
  const c = cfg ?? config;
  if (!c.apiKey) {
    throw new Error(
      'XFYUN_API_KEY is required. Set it via --api-key, .env, or environment variable.',
    );
  }
}

/**
 * 交互式补全缺失的必填配置项
 * 当 apiKey 为空且 stdin 是 TTY 时，提示用户输入；非 TTY 环境直接跳过（由 validateConfig 报错）
 */
export async function promptMissingConfig(cfg: ResolvedConfig): Promise<ResolvedConfig> {
  if (cfg.apiKey || !process.stdin.isTTY) return cfg;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const key = await rl.question(
      'XFYUN_API_KEY not found. Please enter your iFlytek Coding Plan API Key: ',
    );
    const trimmed = key.trim();
    if (trimmed) {
      cfg.apiKey = trimmed;
      config = cfg;
    }
  } finally {
    rl.close();
  }
  return cfg;
}
