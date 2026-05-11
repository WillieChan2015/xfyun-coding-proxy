import { createInterface } from 'node:readline/promises';
import { listBackups, previewBackup, restoreBackup } from './claude-code';
import type { CliOptions } from '../cli';
import type { BackupEntry } from './types';

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

function shortenPath(filePath: string): string {
  const home = process.env.HOME || '';
  if (home && filePath.startsWith(home)) {
    return '~' + filePath.slice(home.length);
  }
  return filePath;
}

function printBackupList(backups: BackupEntry[]): void {
  console.log('');
  console.log('Claude Code 配置备份：');
  console.log('  #  文件                                            时间');
  for (let i = 0; i < backups.length; i++) {
    const b = backups[i];
    console.log(`  ${i + 1}  ${shortenPath(b.filePath).padEnd(50)} ${b.displayTime}`);
  }
  console.log('');
}

function printBackupPreview(backupFilePath: string): void {
  const { content, diffs } = previewBackup(backupFilePath);

  console.log('备份内容预览：');
  console.log(`  ─── ${shortenPath(backupFilePath)} ───`);
  const indented = content.split('\n').map((line) => `  ${line}`).join('\n');
  console.log(indented);

  if (diffs.length > 0) {
    console.log('');
    console.log('  ─── 与当前配置的差异 ───');
    for (const diff of diffs) {
      console.log(`  ${diff.path}`);
      console.log(`    当前值: ${diff.oldValue ?? '(未设置)'}`);
      console.log(`    备份值: ${diff.newValue}`);
      console.log('');
    }
  }
}

export async function handleRestoreCommand(opts: CliOptions): Promise<void> {
  const nonInteractive = opts.setupNonInteractive ?? false;
  const listOnly = opts.setupRestoreList ?? false;
  const latest = opts.setupRestoreLatest ?? false;

  const backups = listBackups();

  if (backups.length === 0) {
    console.log('未找到由 maas-coding-proxy 创建的备份文件。');
    process.exit(0);
  }

  if (listOnly) {
    printBackupList(backups);
    process.exit(0);
  }

  printBackupList(backups);

  let selectedIndex: number;

  if (latest) {
    selectedIndex = 0;
  } else if (nonInteractive) {
    console.error('非交互模式下请指定 --latest');
    process.exit(1);
  } else {
    selectedIndex = await select(
      '请选择要查看/恢复的备份',
      backups.length,
      nonInteractive,
      0,
    );

    if (selectedIndex < 0 || selectedIndex >= backups.length) {
      console.error('无效的选择。');
      process.exit(1);
    }
  }

  const selected = backups[selectedIndex];

  if (!nonInteractive && !latest) {
    printBackupPreview(selected.filePath);

    if (!await confirm('是否恢复此备份？', nonInteractive)) {
      console.log('已取消。');
      process.exit(0);
    }
  } else if (!nonInteractive && latest) {
    console.log(`即将恢复: ${shortenPath(selected.filePath)}`);
    console.log(`恢复到: ${shortenPath(selected.originalPath)}`);
    console.log('');

    if (!await confirm('确认恢复？', nonInteractive)) {
      console.log('已取消。');
      process.exit(0);
    }
  }

  const result = restoreBackup(selected.filePath);

  if (!result.success) {
    console.error(`❌ 恢复失败: ${result.error}`);
    process.exit(1);
  }

  console.log('  ✅ 已恢复配置');
  if (result.backupPath) {
    console.log(`  📦 当前配置已备份: ${shortenPath(result.backupPath)}`);
  }
  console.log('  请重启 Claude Code 使配置生效。');
}
