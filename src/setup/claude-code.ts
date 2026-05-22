import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { DEFAULT_MODEL } from '../config';
import type { ClientSetup, SetupPreview, SetupResult, BackupEntry, ConfigDiff, RestoreResult } from './types';

function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json');
}

export function getEnvPath(): string {
  return join(getConfigDir(), '.env');
}

export function detectClaudeCode(): string | null {
  try {
    const version = execSync('claude --version', {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return version || null;
  } catch {
    return null;
  }
}

export function readSettings(filePath: string): { data: Record<string, unknown>; parseFailed: boolean } {
  if (!existsSync(filePath)) return { data: {}, parseFailed: false };
  try {
    const content = readFileSync(filePath, 'utf8');
    return { data: JSON.parse(content) as Record<string, unknown>, parseFailed: false };
  } catch {
    return { data: {}, parseFailed: true };
  }
}

export function backupPath(filePath: string): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${filePath}.maas-proxy-bak.${ts}`;
}

const BAK_SUFFIX_RE = /\.maas-proxy-bak\.\d{14}$/;

export function originalPathFromBackup(backupFilePath: string): string | null {
  if (!BAK_SUFFIX_RE.test(backupFilePath)) return null;
  return backupFilePath.replace(BAK_SUFFIX_RE, '');
}

export function formatTimestamp(ts: string): string {
  if (ts.length !== 14) return ts;
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`;
}

export function listBackups(): BackupEntry[] {
  const configDir = getConfigDir();
  const entries: BackupEntry[] = [];

  try {
    const files = readdirSync(configDir);
    for (const file of files) {
      const match = file.match(/^(.+)\.maas-proxy-bak\.(\d{14})$/);
      if (!match) continue;

      const filePath = join(configDir, file);
      const timestamp = match[2];
      const originalPath = join(configDir, match[1]);

      entries.push({
        filePath,
        timestamp,
        displayTime: formatTimestamp(timestamp),
        originalPath,
      });
    }
  } catch {
    // 配置目录不存在，返回空列表
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

const MANAGED_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'] as const;

export function previewBackup(backupFilePath: string): {
  content: string;
  diffs: ConfigDiff[];
} {
  let rawContent: string;
  try {
    rawContent = readFileSync(backupFilePath, 'utf8');
  } catch {
    return { content: '⚠️ 备份文件内容无法读取', diffs: [] };
  }

  const isJson = backupFilePath.replace(/\.maas-proxy-bak\.\d{14}$/, '').endsWith('.json');

  let content: string;
  let backupEnv: Record<string, string> = {};

  if (isJson) {
    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      const masked = JSON.parse(JSON.stringify(parsed));
      if (masked.env && typeof masked.env === 'object') {
        backupEnv = { ...(masked.env as Record<string, string>) };
        if (masked.env.ANTHROPIC_API_KEY && typeof masked.env.ANTHROPIC_API_KEY === 'string') {
          masked.env.ANTHROPIC_API_KEY = maskApiKey(masked.env.ANTHROPIC_API_KEY);
        }
      }
      content = JSON.stringify(masked, null, 2);
    } catch {
      content = rawContent;
    }
  } else {
    const lines = rawContent.split('\n').map((line) => {
      const match = line.match(/^(ANTHROPIC_API_KEY)=(.+)$/);
      if (match) {
        backupEnv[match[1]] = match[2];
        return `${match[1]}=${maskApiKey(match[2])}`;
      }
      const kvMatch = line.match(/^([A-Z_]+)=(.*)$/);
      if (kvMatch) {
        backupEnv[kvMatch[1]] = kvMatch[2];
      }
      return line;
    });
    content = lines.join('\n');
  }

  const originalPath = originalPathFromBackup(backupFilePath);
  const diffs: ConfigDiff[] = [];

  if (originalPath) {
    const currentEnv = readCurrentEnv(originalPath);

    for (const key of MANAGED_KEYS) {
      const envPath = `env.${key}`;
      const currentValue = currentEnv[key] ?? null;
      const backupValue = backupEnv[key] ?? null;

      const displayCurrent = key === 'ANTHROPIC_API_KEY' && currentValue
        ? maskApiKey(currentValue)
        : currentValue;
      const displayBackup = key === 'ANTHROPIC_API_KEY' && backupValue
        ? maskApiKey(backupValue)
        : backupValue;

      if (currentValue === backupValue) {
        diffs.push({
          path: envPath,
          oldValue: displayCurrent ?? '(未设置)',
          newValue: `${displayBackup ?? '(未设置)'}  (无变化)`,
        });
      } else {
        diffs.push({
          path: envPath,
          oldValue: displayCurrent ?? null,
          newValue: displayBackup ?? '(未设置)',
        });
      }
    }
  }

  return { content, diffs };
}

function readCurrentEnv(configPath: string): Record<string, string> {
  if (!existsSync(configPath)) return {};

  if (configPath.endsWith('.json')) {
    const settings = readSettings(configPath);
    if (settings.parseFailed) return {};
    if (typeof settings.data.env === 'object') {
      return { ...(settings.data.env as Record<string, string>) };
    }
    return {};
  }

  try {
    const lines = readFileSync(configPath, 'utf8').split('\n');
    const env: Record<string, string> = {};
    for (const line of lines) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

export function restoreBackup(backupFilePath: string): RestoreResult {
  const originalPath = originalPathFromBackup(backupFilePath);
  if (!originalPath) {
    return { success: false, error: '无法确定恢复目标路径' };
  }

  if (!existsSync(backupFilePath)) {
    return { success: false, error: '备份文件不存在' };
  }

  try {
    let currentBackup: string | undefined;
    if (existsSync(originalPath)) {
      currentBackup = backupPath(originalPath);
      copyFileSync(originalPath, currentBackup);
    }

    copyFileSync(backupFilePath, originalPath);

    return { success: true, backupPath: currentBackup, restoredPath: originalPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

export function previewClaudeCodeSettings(
  port: number,
  apiKey: string,
  settingsPath?: string,
): SetupPreview {
  const resolvedPath = settingsPath ?? getSettingsPath();
  const { data: existing } = readSettings(resolvedPath);
  const env = (existing.env ?? {}) as Record<string, string>;

  const newBaseUrl = `http://127.0.0.1:${port}/anthropic`;
  const newModel = DEFAULT_MODEL;

  const diffs = [];

  if (env.ANTHROPIC_BASE_URL !== newBaseUrl) {
    diffs.push({
      path: 'env.ANTHROPIC_BASE_URL',
      oldValue: env.ANTHROPIC_BASE_URL ?? null,
      newValue: newBaseUrl,
    });
  }

  if (env.ANTHROPIC_API_KEY !== apiKey) {
    diffs.push({
      path: 'env.ANTHROPIC_API_KEY',
      oldValue: env.ANTHROPIC_API_KEY ? maskApiKey(env.ANTHROPIC_API_KEY) : null,
      newValue: maskApiKey(apiKey),
    });
  }

  if (env.ANTHROPIC_MODEL !== newModel) {
    diffs.push({
      path: 'env.ANTHROPIC_MODEL',
      oldValue: env.ANTHROPIC_MODEL ?? null,
      newValue: newModel,
    });
  }

  return { configPath: resolvedPath, diffs };
}

export function applySettingsJson(port: number, apiKey: string): SetupResult {
  const settingsPath = getSettingsPath();

  try {
    const { data: existing, parseFailed } = readSettings(settingsPath);
    if (parseFailed) {
      return { success: false, error: `配置文件格式错误: ${settingsPath}` };
    }

    let backup: string | undefined;
    if (existsSync(settingsPath)) {
      backup = backupPath(settingsPath);
      copyFileSync(settingsPath, backup);
    }

    const env = (existing.env ?? {}) as Record<string, string>;
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/anthropic`;
    env.ANTHROPIC_API_KEY = apiKey;
    env.ANTHROPIC_MODEL = DEFAULT_MODEL;
    existing.env = env;

    writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

    return { success: true, backupPath: backup, writtenPath: settingsPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export function applyEnvFile(port: number, apiKey: string): SetupResult {
  const envPath = getEnvPath();

  try {
    let lines: string[] = [];
    if (existsSync(envPath)) {
      lines = readFileSync(envPath, 'utf8').split('\n');
    }

    let backup: string | undefined;
    if (existsSync(envPath)) {
      backup = backupPath(envPath);
      copyFileSync(envPath, backup);
    }

    const updates: Record<string, string> = {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/anthropic`,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_MODEL: DEFAULT_MODEL,
    };

    const updatedKeys = new Set<string>();
    const newLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && match[1] in updates) {
        newLines.push(`${match[1]}=${updates[match[1]]}`);
        updatedKeys.add(match[1]);
      } else {
        newLines.push(line);
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      if (!updatedKeys.has(key)) {
        newLines.push(`${key}=${value}`);
      }
    }

    const content = newLines.join('\n').replace(/\n+$/, '') + '\n';
    writeFileSync(envPath, content, 'utf8');

    return { success: true, backupPath: backup, writtenPath: envPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export const claudeCodeSetup: ClientSetup = {
  name: 'Claude Code',
  supported: true,
  detect: async () => detectClaudeCode(),
  preview: async (port, apiKey) => previewClaudeCodeSettings(port, apiKey),
  apply: async (port, apiKey, writeTarget) => {
    if (writeTarget === 'env-file') {
      return applyEnvFile(port, apiKey);
    }
    return applySettingsJson(port, apiKey);
  },
};
