import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { resolveEnvFile } from './config';
import { CLIENT_REGISTRY } from './setup/types';
import type { CliOptions } from './cli';
import type { WriteTarget } from './setup/types';

function resolveSetupConfig(opts: CliOptions): { port: number; apiKey: string } {
  const envFile = resolveEnvFile(opts.config);
  if (envFile) dotenv.config({ path: envFile });

  const port = opts.port ?? parseInt(process.env.PORT || '3000', 10);
  const apiKey = opts.apiKey ?? process.env.XFYUN_API_KEY ?? '';

  return { port, apiKey };
}

async function confirm(prompt: string, nonInteractive: boolean): Promise<boolean> {
  if (nonInteractive) return true;
  if (!process.stdin.isTTY) {
    console.error('非交互模式请使用 --non-interactive');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} (y/N): `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

async function select(prompt: string, count: number, nonInteractive: boolean, defaultIndex: number): Promise<number> {
  if (nonInteractive) return defaultIndex;
  if (!process.stdin.isTTY) {
    console.error('非交互模式请使用 --non-interactive');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} (1-${count}): `);
    const num = parseInt(answer.trim(), 10);
    if (num >= 1 && num <= count) return num - 1;
    return -1;
  } finally {
    rl.close();
  }
}

function formatPreview(configPath: string, diffs: Array<{ path: string; oldValue: string | null; newValue: string }>): string {
  const lines: string[] = [];
  lines.push(`  以下配置将写入 ${configPath}`);
  lines.push('  ──────────────────────────────────────────────');

  for (const diff of diffs) {
    lines.push(`  ${diff.path}`);
    lines.push(`    旧值: ${diff.oldValue ?? '(未设置)'}`);
    lines.push(`    新值: ${diff.newValue}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function handleSetupCommand(opts: CliOptions): Promise<void> {
  const nonInteractive = opts.setupNonInteractive ?? false;
  const { port, apiKey } = resolveSetupConfig(opts);

  if (!apiKey) {
    console.error('❌ XFYUN_API_KEY 未设置，请先配置代理（通过 --api-key、.env 或环境变量）。');
    process.exit(1);
  }

  const supportedEntries = CLIENT_REGISTRY.filter(e => e.setup.supported);

  if (supportedEntries.length === 0) {
    console.error('暂无可配置的客户端，敬请期待。');
    process.exit(1);
  }

  console.log('');
  console.log('可配置的客户端类型：');
  for (const entry of supportedEntries) {
    console.log(`  ${entry.id}) ${entry.setup.name}`);
  }
  console.log('');

  const clientIndex = await select(
    '请选择要配置的客户端',
    supportedEntries.length,
    nonInteractive,
    0,
  );

  if (clientIndex < 0 || clientIndex >= supportedEntries.length) {
    console.error('无效的选择。');
    process.exit(1);
  }

  const selectedEntry = supportedEntries[clientIndex];
  const client = selectedEntry.setup;

  console.log('');
  console.log(`步骤 1/4：检测 ${client.name} 安装`);

  const version = await client.detect();
  if (!version) {
    console.error(`❌ 未检测到 ${client.name}，请先安装。`);
    process.exit(1);
  }
  console.log(`  ✅ 已检测到 ${client.name} (${version})`);

  console.log('');
  console.log('步骤 2/4：预览配置变更');

  const preview = await client.preview(port, apiKey);

  if (preview.diffs.length === 0) {
    console.log('  配置已是最新，无需更新。');
    process.exit(0);
  }

  console.log(formatPreview(preview.configPath, preview.diffs));

  console.log('步骤 3/4：选择写入方式');
  console.log('  1) 写入 settings.json（推荐，Claude Code 原生支持）');
  console.log('  2) 写入 .env 文件（环境变量文件）');
  console.log('');

  const writeIndex = await select(
    '请选择写入方式',
    2,
    nonInteractive,
    0,
  );

  const writeTarget: WriteTarget = writeIndex === 1 ? 'env-file' : 'settings-json';

  console.log('步骤 4/4：确认并执行');

  if (!await confirm('即将备份并写入配置，是否继续？', nonInteractive)) {
    console.log('已取消。');
    process.exit(0);
  }

  const result = await client.apply(port, apiKey, writeTarget);

  if (!result.success) {
    console.error(`❌ 配置写入失败: ${result.error}`);
    process.exit(1);
  }

  if (result.backupPath) {
    console.log(`  📦 已备份: ${result.backupPath}`);
  }
  console.log('  ✅ 配置已更新');
  console.log('');
  console.log(`  ${client.name} 已配置为使用本地代理。`);
  console.log('  请重启 Claude Code 使配置生效。');
}
