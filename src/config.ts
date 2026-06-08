import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { z } from 'zod';
import { CliOptions } from './cli';

/** 代理强制覆盖的模型 ID，所有协议路由统一使用 */
export const DEFAULT_MODEL = 'astron-code-latest';

/** 支持的讯飞模型元数据 */
export interface SupportedModel {
  /** 讯飞平台模型 ID，如 "xopdeepseekv4pro" */
  id: string;
  /** 显示名称，如 "DeepSeek-V4-Pro" */
  name: string;
  /** 上下文长度，如 1_000_000 */
  contextLength: number;
}

/** 支持的讯飞模型列表（硬编码白名单），新增模型时同步更新此数组 */
export const SUPPORTED_MODELS: SupportedModel[] = [
  { id: 'xsparkx2',         name: 'Spark X2',            contextLength: 128_000 },
  { id: 'xopglm5',          name: 'GLM-5',               contextLength: 200_000 },
  { id: 'xopdeepseekv4pro', name: 'DeepSeek-V4-Pro',     contextLength: 1_000_000 },
  { id: 'xopdeepseekv4flash', name: 'DeepSeek-V4-Flash', contextLength: 1_000_000 },
  { id: 'xopkimik26',       name: 'Kimi-K2.6',           contextLength: 256_000 },
  { id: 'xopglm51',         name: 'GLM-5.1',             contextLength: 200_000 },
  { id: 'xminimaxm25',      name: 'MiniMax-M2.5',        contextLength: 128_000 },
  { id: 'xopkimik25',       name: 'Kimi-K2.5',           contextLength: 128_000 },
  { id: 'xopdeepseekv32',   name: 'DeepSeek-V3.2',       contextLength: 128_000 },
  { id: 'xsparkx2flash',    name: 'Spark-X2-Flash',      contextLength: 256_000 },
  { id: 'xopqwen36v35b',    name: 'Qwen3.6-35B-A3B',    contextLength: 128_000 },
  { id: 'xopglmv47flash',   name: 'GLM-4.7-Flash',       contextLength: 128_000 },
  { id: 'xopqwen35v35b',    name: 'Qwen3.5-35B-A3B',    contextLength: 128_000 },
  { id: 'xop3qwencodernext', name: 'Qwen3-Coder-Next-FP8', contextLength: 256_000 },
  { id: 'xopqwen35397b',    name: 'Qwen3.5-397B-A17B',  contextLength: 256_000 },
];

/** 快速查找：模型 ID → SupportedModel，用于 resolveModelId 白名单校验 */
export const MODEL_MAP = new Map<string, SupportedModel>(
  SUPPORTED_MODELS.map(m => [m.id, m]),
);

/**
 * 解析请求中的模型 ID
 * - 开关关闭（默认）：始终返回 DEFAULT_MODEL
 * - 开关开启：匹配白名单则返回原值，否则回退并记录日志
 *
 * ⚠️ 开关状态在函数内部动态读取 process.env，而非模块顶层求值。
 * 原因：loadConfig() 通过 dotenv.config() 加载 .env 到 process.env，
 * 若在 import 时求值，dotenv 尚未执行，环境变量始终为 undefined。
 */
export function resolveModelId(
  requestedModel: string | undefined,
  log?: { warn: (msg: string) => void },
): string {
  // 动态读取，确保 dotenv 加载后值正确
  if (process.env.XFYUN_ALLOW_CUSTOM_MODEL !== 'true') {
    return DEFAULT_MODEL;
  }
  if (!requestedModel || requestedModel === DEFAULT_MODEL) {
    return DEFAULT_MODEL;
  }
  if (MODEL_MAP.has(requestedModel)) {
    return requestedModel;
  }
  log?.warn(`Unsupported model "${requestedModel}", fallback to ${DEFAULT_MODEL}`);
  return DEFAULT_MODEL;
}

export const configSchema = z.object({
  port: z.number().int().min(1, 'Port must be >= 1').max(65535, 'Port must be <= 65535'),
  apiKey: z.string().min(1, 'XFYUN_API_KEY is required'),
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  anthropicBaseUrl: z.string().url('anthropicBaseUrl must be a valid URL'),
  maxRetries: z.number().int().min(0, 'maxRetries must be >= 0').max(10, 'maxRetries must be <= 10'),
  retryDelay: z.number().int().min(100, 'retryDelay must be >= 100').max(60_000, 'retryDelay must be <= 60000'),
  debug: z.boolean(),
  verbose: z.boolean(),
  monitor: z.boolean(),
  logDir: z.string().min(1, 'logDir is required'),
  statsDir: z.string().min(1, 'statsDir is required'),
  statsFlushInterval: z.number().int().min(0, 'statsFlushInterval must be >= 0'),
  streamReadTimeout: z.number().int().min(1_000, 'streamReadTimeout must be >= 1000').max(300_000, 'streamReadTimeout must be <= 300000'),
  upstreamFetchTimeout: z.number().int().min(30_000, 'upstreamFetchTimeout must be >= 30000').max(600_000, 'upstreamFetchTimeout must be <= 600000'),
  midConversationSystem: z.boolean(),
  configFile: z.string().optional(),
});

export type ResolvedConfig = z.infer<typeof configSchema>;

const DEFAULT_CONFIG: ResolvedConfig = {
  port: 3000,
  apiKey: '',
  baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
  anthropicBaseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic',
  maxRetries: 3,
  retryDelay: 1000,
  debug: false,
  verbose: false,
  monitor: true,
  logDir: './logs',
  statsDir: './logs/stats',
  statsFlushInterval: 60_000,
  streamReadTimeout: 60_000,
  upstreamFetchTimeout: 300_000,
  midConversationSystem: true,
  configFile: undefined,
};

// 模块级 config：loadConfig() 调用后赋值，proxy.ts 等通过 import { config } 读取
// 初始值提供合理默认，避免测试中 import 时为 undefined
// ⚠️ 注意：apiKey 初始为空字符串，使用前必须调用 loadConfig() + validateConfig() 初始化，
// 否则上游请求会因缺少凭据而返回 401
export let config: ResolvedConfig = { ...DEFAULT_CONFIG };

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

  const resolvedLogDir = resolveLogDir(cliOpts.logDir);
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
    debug: cliOpts.debug ?? process.env.DEBUG_PROXY === '1',
    verbose: cliOpts.verbose ?? process.env.VERBOSE === 'true',
    // monitor: CLI --no-monitor(false) 优先，其次环境变量 MONITOR=false/0 禁用，默认 true
    monitor: cliOpts.monitor ?? !['false', '0'].includes((process.env.MONITOR ?? '').toLowerCase()),
    logDir: resolvedLogDir,
    statsDir: join(resolvedLogDir, 'stats'),
    statsFlushInterval: parseInt(process.env.STATS_FLUSH_INTERVAL_MS || '60000', 10),
    streamReadTimeout: parseInt(process.env.STREAM_READ_TIMEOUT_MS || '60000', 10),
    upstreamFetchTimeout: parseInt(process.env.UPSTREAM_FETCH_TIMEOUT_MS || '300000', 10),
    // 中途 system 消息转换：默认开启，将 messages 中的 role: "system" 提取到 system 字段
    midConversationSystem: process.env.XFYUN_MID_CONVERSATION_SYSTEM !== 'false',
    configFile: envFile,
  };

  config = resolved;
  return resolved;
}

/**
 * 校验配置对象，失败时抛出包含所有字段错误的 Error
 * 在 promptMissingConfig 之后调用，确保交互式补全的值也被校验
 */
export function validateConfig(cfg?: ResolvedConfig): void {
  const c = cfg ?? config;
  const parsed = configSchema.safeParse(c);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }
  config = parsed.data;
}

/**
 * 交互式补全缺失的必填配置项
 * 当 apiKey 为空且 stdin 是 TTY 时，提示用户输入；非 TTY 环境直接跳过（由 schema 校验报错）
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

/**
 * 重置 config 为默认值，用于测试隔离
 * 在测试的 beforeEach 中调用，避免测试间互相污染
 */
export function resetConfigForTesting(): void {
  config = { ...DEFAULT_CONFIG };
}
