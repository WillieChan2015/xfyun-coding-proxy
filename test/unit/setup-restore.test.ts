import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  originalPathFromBackup,
  formatTimestamp,
  listBackups,
  previewBackup,
  restoreBackup,
} from '../../src/setup/claude-code';

const TMP_DIR = '/tmp/test-restore-backups';

describe('setup restore 逻辑', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = TMP_DIR;
  });

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  });

  describe('originalPathFromBackup', () => {
    it('strips .maas-proxy-bak.{timestamp} suffix from settings.json', () => {
      expect(originalPathFromBackup('/home/.claude/settings.json.maas-proxy-bak.20260511143025'))
        .toBe('/home/.claude/settings.json');
    });

    it('strips suffix from .env backup', () => {
      expect(originalPathFromBackup('/home/.claude/.env.maas-proxy-bak.20260511143052'))
        .toBe('/home/.claude/.env');
    });

    it('returns null for non-backup file', () => {
      expect(originalPathFromBackup('/home/.claude/settings.json')).toBeNull();
    });

    it('returns null for wrong timestamp length', () => {
      expect(originalPathFromBackup('/home/.claude/settings.json.maas-proxy-bak.20260511')).toBeNull();
    });
  });

  describe('formatTimestamp', () => {
    it('formats 14-digit timestamp', () => {
      expect(formatTimestamp('20260511143025')).toBe('2026-05-11 14:30:25');
    });

    it('returns raw string for non-14-digit input', () => {
      expect(formatTimestamp('20260511')).toBe('20260511');
    });
  });

  describe('listBackups', () => {
    it('returns empty array when no backups exist', () => {
      const backups = listBackups();
      expect(backups.length).toBe(0);
    });

    it('finds backup files and sorts by timestamp descending', () => {
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), '{}');
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511150000'), '{}');

      const backups = listBackups();
      expect(backups.length).toBe(2);
      expect(backups[0].timestamp).toBe('20260511150000');
      expect(backups[1].timestamp).toBe('20260511143025');
    });

    it('ignores non-backup files', () => {
      writeFileSync(join(TMP_DIR, 'settings.json'), '{}');
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), '{}');

      const backups = listBackups();
      expect(backups.length).toBe(1);
    });

    it('populates originalPath correctly', () => {
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), '{}');

      const backups = listBackups();
      expect(backups[0].originalPath).toBe(join(TMP_DIR, 'settings.json'));
    });
  });

  describe('previewBackup', () => {
    it('returns formatted JSON content for .json backup', () => {
      const content = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://example.com' } }, null, 2);
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), content);

      const preview = previewBackup(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'));
      expect(preview.content).toContain('ANTHROPIC_BASE_URL');
    });

    it('masks API key in JSON backup', () => {
      const content = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-api03-1234567890abcdef' } }, null, 2);
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), content);

      const preview = previewBackup(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'));
      expect(preview.content).toContain('sk-a...cdef');
      expect(preview.content).not.toContain('sk-ant-api03-1234567890abcdef');
    });

    it('returns error message for unreadable file', () => {
      const preview = previewBackup('/nonexistent/backup.json.maas-proxy-bak.20260511143025');
      expect(preview.content).toContain('无法读取');
    });

    it('generates diffs against current config', () => {
      const backupContent = JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://original.example.com/anthropic',
          ANTHROPIC_API_KEY: 'sk-original-key-12345678',
          ANTHROPIC_MODEL: 'some-model',
        },
      }, null, 2);
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), backupContent);

      const currentContent = JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:3000/anthropic',
          ANTHROPIC_API_KEY: 'sk-current-key-12345678',
          ANTHROPIC_MODEL: 'some-model',
        },
      }, null, 2);
      writeFileSync(join(TMP_DIR, 'settings.json'), currentContent);

      const preview = previewBackup(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'));
      expect(preview.diffs.length).toBe(3);
      const modelDiff = preview.diffs.find(d => d.path === 'env.ANTHROPIC_MODEL');
      expect(modelDiff?.newValue).toContain('(无变化)');
    });
  });

  describe('restoreBackup', () => {
    it('restores backup to original path', () => {
      const backupContent = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://original.example.com/anthropic' } }, null, 2);
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), backupContent);

      const result = restoreBackup(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'));
      expect(result.success).toBe(true);
      expect(result.restoredPath).toBe(join(TMP_DIR, 'settings.json'));
    });

    it('backs up current config before restoring', () => {
      const backupContent = JSON.stringify({ env: {} }, null, 2);
      writeFileSync(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'), backupContent);
      writeFileSync(join(TMP_DIR, 'settings.json'), '{"current": true}');

      const result = restoreBackup(join(TMP_DIR, 'settings.json.maas-proxy-bak.20260511143025'));
      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      if (result.backupPath) {
        expect(existsSync(result.backupPath)).toBe(true);
      }
    });

    it('returns error for non-backup file path', () => {
      const result = restoreBackup('/home/.claude/settings.json');
      expect(result.success).toBe(false);
      expect(result.error).toContain('无法确定恢复目标路径');
    });

    it('returns error when backup file does not exist', () => {
      const result = restoreBackup('/home/.claude/settings.json.maas-proxy-bak.20260511143025');
      expect(result.success).toBe(false);
      expect(result.error).toContain('备份文件不存在');
    });
  });
});
