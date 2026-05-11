/**
 * 客户端配置器接口
 * 每个支持的客户端实现此接口，注册到 CLIENT_REGISTRY
 */
export interface ClientSetup {
  /** 客户端显示名称 */
  name: string;
  /** 是否已实现 */
  supported: boolean;
  /** 检测客户端是否已安装，返回版本号或 null */
  detect(): Promise<string | null>;
  /** 生成配置变更预览 */
  preview(port: number, apiKey: string): Promise<SetupPreview>;
  /** 执行配置写入 */
  apply(port: number, apiKey: string, writeTarget: WriteTarget): Promise<SetupResult>;
}

/** 配置变更项 */
export interface ConfigDiff {
  /** 配置路径（如 env.ANTHROPIC_BASE_URL） */
  path: string;
  /** 旧值，null 表示未设置 */
  oldValue: string | null;
  /** 新值 */
  newValue: string;
}

/** 配置预览结果 */
export interface SetupPreview {
  /** 目标配置文件路径 */
  configPath: string;
  /** 变更项列表 */
  diffs: ConfigDiff[];
}

/** 写入目标 */
export type WriteTarget = 'settings-json' | 'env-file';

/** 配置写入结果 */
export interface SetupResult {
  /** 是否成功 */
  success: boolean;
  /** 备份文件路径（如有） */
  backupPath?: string;
  /** 写入的文件路径 */
  writtenPath?: string;
  /** 错误信息（失败时） */
  error?: string;
}

/** 备份文件条目 */
export interface BackupEntry {
  /** 备份文件完整路径 */
  filePath: string;
  /** 从文件名提取的原始时间戳（14 位数字字符串） */
  timestamp: string;
  /** 格式化后的可读时间（如 2026-05-11 14:30:25） */
  displayTime: string;
  /** 推算的原始配置文件路径 */
  originalPath: string;
}

/** 恢复操作结果 */
export interface RestoreResult {
  /** 是否成功 */
  success: boolean;
  /** 恢复前对当前配置的备份路径（如有） */
  backupPath?: string;
  /** 恢复到的目标文件路径 */
  restoredPath?: string;
  /** 错误信息（失败时） */
  error?: string;
}

/** 客户端注册表项 */
export interface ClientRegistryEntry {
  id: number;
  setup: ClientSetup;
}

/** 客户端注册表 */
export const CLIENT_REGISTRY: ClientRegistryEntry[] = [];

import { claudeCodeSetup } from './claude-code';

CLIENT_REGISTRY.push(
  { id: 1, setup: claudeCodeSetup },
  { id: 2, setup: { name: 'Cursor', supported: false, detect: async () => null, preview: async () => ({ configPath: '', diffs: [] }), apply: async () => ({ success: false, error: 'not implemented' }) } },
  { id: 3, setup: { name: 'Trae', supported: false, detect: async () => null, preview: async () => ({ configPath: '', diffs: [] }), apply: async () => ({ success: false, error: 'not implemented' }) } },
  { id: 4, setup: { name: 'OpenCode', supported: false, detect: async () => null, preview: async () => ({ configPath: '', diffs: [] }), apply: async () => ({ success: false, error: 'not implemented' }) } },
);
