import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  resolveModelId,
  SUPPORTED_MODELS,
  MODEL_MAP,
  DEFAULT_MODEL,
} from '../../src/config';

describe('resolveModelId', () => {
  const originalEnv = process.env.XFYUN_ALLOW_CUSTOM_MODEL;

  beforeEach(() => {
    // 每个测试前清除环境变量
    delete process.env.XFYUN_ALLOW_CUSTOM_MODEL;
  });

  afterEach(() => {
    // 恢复原始环境变量
    if (originalEnv !== undefined) {
      process.env.XFYUN_ALLOW_CUSTOM_MODEL = originalEnv;
    } else {
      delete process.env.XFYUN_ALLOW_CUSTOM_MODEL;
    }
  });

  it('开关关闭时，白名单内 model 正常透传', () => {
    expect(resolveModelId('xopdeepseekv4pro')).toBe('xopdeepseekv4pro');
    expect(resolveModelId('xsparkx2')).toBe('xsparkx2');
  });

  it('开关关闭时，白名单外 model 回退到 DEFAULT_MODEL', () => {
    expect(resolveModelId('some-random-model')).toBe(DEFAULT_MODEL);
    expect(resolveModelId('gpt-4')).toBe(DEFAULT_MODEL);
  });

  it('白名单内 model 无需开关即可透传', () => {
    expect(resolveModelId('xopdeepseekv4pro')).toBe('xopdeepseekv4pro');
    expect(resolveModelId('xsparkx2')).toBe('xsparkx2');
    expect(resolveModelId('xopglm5')).toBe('xopglm5');
  });

  it('白名单外 model → 回退 + warn 日志（无论开关状态）', () => {
    const warnings: string[] = [];
    const mockLog = { warn: (msg: string) => warnings.push(msg) };
    const result = resolveModelId('gpt-4', mockLog);
    expect(result).toBe(DEFAULT_MODEL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('gpt-4');
    expect(warnings[0]).toContain(DEFAULT_MODEL);
  });

  it('开关开启 + model 为空字符串 → 返回 DEFAULT_MODEL', () => {
    process.env.XFYUN_ALLOW_CUSTOM_MODEL = 'true';
    expect(resolveModelId('')).toBe(DEFAULT_MODEL);
  });

  it('开关开启 + model 为 DEFAULT_MODEL → 直接返回，不产生 warn', () => {
    process.env.XFYUN_ALLOW_CUSTOM_MODEL = 'true';
    const warnings: string[] = [];
    const mockLog = { warn: (msg: string) => warnings.push(msg) };
    expect(resolveModelId(DEFAULT_MODEL, mockLog)).toBe(DEFAULT_MODEL);
    expect(warnings).toHaveLength(0);
  });

  it('开关开启 + model 为 undefined → 返回 DEFAULT_MODEL', () => {
    process.env.XFYUN_ALLOW_CUSTOM_MODEL = 'true';
    expect(resolveModelId(undefined)).toBe(DEFAULT_MODEL);
  });

  it('开关开启 + 白名单外 model → 透传', () => {
    process.env.XFYUN_ALLOW_CUSTOM_MODEL = 'true';
    expect(resolveModelId('gpt-4')).toBe('gpt-4');
    expect(resolveModelId('claude-3-opus')).toBe('claude-3-opus');
  });

  it('dotenv 加载后开关生效（动态读取验证）', () => {
    // 白名单内模型始终可用
    expect(resolveModelId('xopdeepseekv4pro')).toBe('xopdeepseekv4pro');
    // 白名单外模型：开关关闭时回退
    expect(resolveModelId('gpt-4')).toBe(DEFAULT_MODEL);
    // 设置环境变量后，白名单外模型透传
    process.env.XFYUN_ALLOW_CUSTOM_MODEL = 'true';
    expect(resolveModelId('gpt-4')).toBe('gpt-4');
  });
});

describe('SUPPORTED_MODELS', () => {
  it('包含 16 个模型', () => {
    expect(SUPPORTED_MODELS).toHaveLength(16);
  });

  it('每个模型都有 id、name、contextLength', () => {
    for (const m of SUPPORTED_MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.contextLength).toBeGreaterThan(0);
    }
  });
});

describe('MODEL_MAP', () => {
  it('存在的 id 返回模型对象', () => {
    const model = MODEL_MAP.get('xopdeepseekv4pro');
    expect(model).toBeDefined();
    expect(model!.id).toBe('xopdeepseekv4pro');
    expect(model!.name).toBe('DeepSeek-V4-Pro');
    expect(model!.contextLength).toBe(1_000_000);
  });

  it('不存在的 id 返回 undefined', () => {
    expect(MODEL_MAP.get('gpt-4')).toBeUndefined();
    expect(MODEL_MAP.get('')).toBeUndefined();
  });
});
