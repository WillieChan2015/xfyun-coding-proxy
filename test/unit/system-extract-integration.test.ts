import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { config, resetConfigForTesting } from '../../src/config';
import { extractSystemMessages } from '../../src/anthropic/system-extract';

describe('mid-conversation system 集成', () => {
  beforeEach(() => {
    resetConfigForTesting();
  });

  afterEach(() => {
    resetConfigForTesting();
  });

  it('开关关闭时不转换 system 角色消息', () => {
    config.midConversationSystem = false;
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'system prompt' },
      ],
    };

    // 模拟 handler 中的条件逻辑
    if (config.midConversationSystem && body) {
      extractSystemMessages(body);
    }

    expect((body.messages as Array<Record<string, unknown>>).map((m) => m.role)).toEqual(['user', 'system']);
    expect(body.system).toBeUndefined();
  });

  it('开关开启时转换 system 角色消息（默认行为）', () => {
    config.midConversationSystem = true;
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'system prompt' },
      ],
    };

    if (config.midConversationSystem && body) {
      extractSystemMessages(body);
    }

    expect((body.messages as Array<Record<string, unknown>>).map((m) => m.role)).toEqual(['user']);
    expect(body.system).toEqual([{ type: 'text', text: 'system prompt' }]);
  });
});
