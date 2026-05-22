import { describe, it, expect } from 'bun:test';
import {
  getSettingsPath,
  getEnvPath,
  maskApiKey,
  backupPath,
  previewClaudeCodeSettings,
  readSettings,
} from '../../src/setup/claude-code';
import { DEFAULT_MODEL } from '../../src/config';

describe('Claude Code 配置逻辑', () => {
  describe('maskApiKey', () => {
    it('masks short keys', () => {
      expect(maskApiKey('sk-12')).toBe('****');
    });

    it('masks long keys showing first 4 and last 4', () => {
      expect(maskApiKey('sk-ant-api03-1234567890abcdef')).toBe('sk-a...cdef');
    });
  });

  describe('backupPath', () => {
    it('appends timestamp to file path', () => {
      const result = backupPath('/home/user/.claude/settings.json');
      expect(result).toMatch(/^\/home\/user\/\.claude\/settings\.json\.maas-proxy-bak\.\d{14}$/);
    });
  });

  describe('getSettingsPath', () => {
    it('returns default path ending with settings.json', () => {
      const path = getSettingsPath();
      expect(path).toMatch(/\.claude\/settings\.json$/);
    });
  });

  describe('getEnvPath', () => {
    it('returns default path ending with .env', () => {
      const path = getEnvPath();
      expect(path).toMatch(/\.claude\/\.env$/);
    });
  });

  describe('readSettings', () => {
    it('returns empty data and parseFailed=false for non-existent file', () => {
      const result = readSettings('/nonexistent/path/settings.json');
      expect(result).toEqual({ data: {}, parseFailed: false });
    });
  });

  describe('previewClaudeCodeSettings', () => {
    it('generates diffs for config', () => {
      const preview = previewClaudeCodeSettings(3000, 'sk-test-key-12345678', '/nonexistent/path/settings.json');
      expect(preview.diffs.length).toBe(3);
      expect(preview.diffs[0].path).toBe('env.ANTHROPIC_BASE_URL');
      expect(preview.diffs[0].newValue).toBe('http://127.0.0.1:3000/anthropic');
      expect(preview.diffs[1].path).toBe('env.ANTHROPIC_API_KEY');
      expect(preview.diffs[2].path).toBe('env.ANTHROPIC_MODEL');
      expect(preview.diffs[2].newValue).toBe(DEFAULT_MODEL);
    });

    it('uses custom port in base URL', () => {
      const preview = previewClaudeCodeSettings(8080, 'sk-test-key-12345678', '/nonexistent/path/settings.json');
      expect(preview.diffs[0].newValue).toBe('http://127.0.0.1:8080/anthropic');
    });
  });
});
