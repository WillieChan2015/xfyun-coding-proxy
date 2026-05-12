import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { loadConfig } from '../../src/config';

describe('config monitor option', () => {
  const originalEnv = process.env.MONITOR;

  beforeEach(() => {
    delete process.env.MONITOR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MONITOR = originalEnv;
    } else {
      delete process.env.MONITOR;
    }
  });

  it('默认启用 monitor', () => {
    const cfg = loadConfig({ verbose: false });
    expect(cfg.monitor).toBe(true);
  });

  it('CLI --no-monitor 禁用 monitor', () => {
    const cfg = loadConfig({ verbose: false, monitor: false });
    expect(cfg.monitor).toBe(false);
  });

  it('环境变量 MONITOR=false 禁用 monitor', () => {
    process.env.MONITOR = 'false';
    const cfg = loadConfig({ verbose: false });
    expect(cfg.monitor).toBe(false);
  });

  it('环境变量 MONITOR=0 禁用 monitor', () => {
    process.env.MONITOR = '0';
    const cfg = loadConfig({ verbose: false });
    expect(cfg.monitor).toBe(false);
  });

  it('环境变量 MONITOR=true 启用 monitor', () => {
    process.env.MONITOR = 'true';
    const cfg = loadConfig({ verbose: false });
    expect(cfg.monitor).toBe(true);
  });

  it('CLI --no-monitor 优先于环境变量 MONITOR=true', () => {
    process.env.MONITOR = 'true';
    const cfg = loadConfig({ verbose: false, monitor: false });
    expect(cfg.monitor).toBe(false);
  });

  it('环境变量 MONITOR 大小写不敏感', () => {
    process.env.MONITOR = 'FALSE';
    const cfg = loadConfig({ verbose: false });
    expect(cfg.monitor).toBe(false);
  });
});
