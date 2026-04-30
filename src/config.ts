import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
import { CliOptions } from './cli';

export interface ResolvedConfig {
  port: number;
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  retryDelay: number;
  verbose: boolean;
  logDir: string;
}

// 模块级 config：loadConfig() 调用后赋值，proxy.ts 等通过 import { config } 读取
// 初始值提供合理默认，避免测试中 import 时为 undefined
export let config: ResolvedConfig = {
  port: 3000,
  apiKey: '',
  baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
  maxRetries: 3,
  retryDelay: 1000,
  verbose: false,
  logDir: './logs',
};

/**
 * 按优先级查找配置文件：
 * 1. --config CLI flag / $XFYUN_CODING_PROXY_CONFIG
 * 2. $XDG_CONFIG_HOME/xfyun-coding-proxy/config.env
 * 3. CWD 下的 .env
 */
export function resolveEnvFile(configPath?: string): string | undefined {
  const explicit = configPath || process.env.XFYUN_CODING_PROXY_CONFIG;
  if (explicit && existsSync(explicit)) return resolve(explicit);

  const xdgHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const xdgPath = join(xdgHome, 'xfyun-coding-proxy', 'config.env');
  if (existsSync(xdgPath)) return xdgPath;

  const cwdEnv = join(process.cwd(), '.env');
  if (existsSync(cwdEnv)) return cwdEnv;

  return undefined;
}

/**
 * 按优先级确定日志目录：
 * 1. --log-dir CLI flag
 * 2. $XFYUN_LOG_DIR 环境变量
 * 3. $XDG_STATE_HOME/xfyun-coding-proxy/logs（回退 ~/.local/state/xfyun-coding-proxy/logs）
 */
function resolveLogDir(cliLogDir?: string): string {
  if (cliLogDir) return resolve(cliLogDir);

  const envLogDir = process.env.XFYUN_LOG_DIR;
  if (envLogDir) return resolve(envLogDir);

  const xdgState = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(xdgState, 'xfyun-coding-proxy', 'logs');
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
    maxRetries: cliOpts.maxRetries ?? parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelay: cliOpts.retryDelay ?? parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
    verbose: cliOpts.verbose ?? process.env.VERBOSE === 'true',
    logDir: resolveLogDir(cliOpts.logDir),
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
