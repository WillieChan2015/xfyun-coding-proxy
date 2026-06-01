import { describe, it, expect } from 'bun:test';
import { extractSystemMessages } from '../../src/anthropic/system-extract';

describe('extractSystemMessages', () => {
  it('无 system 角色消息时不修改请求', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      system: [{ type: 'text', text: 'original system' }],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    expect(body.system).toEqual([{ type: 'text', text: 'original system' }]);
  });

  it('将 messages 中的 system 角色消息提取到 system 字段', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'mid-conversation system prompt' },
      ],
      system: [{ type: 'text', text: 'original system' }],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    // 提取的 system 消息追加到已有 system 字段末尾
    expect(body.system).toEqual([
      { type: 'text', text: 'original system' },
      { type: 'text', text: 'mid-conversation system prompt' },
    ]);
  });

  it('system 字段为字符串时，提取的 system 消息追加到数组', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'extra system' },
      ],
      system: 'original system string',
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    expect(body.system).toEqual([
      { type: 'text', text: 'original system string' },
      { type: 'text', text: 'extra system' },
    ]);
  });

  it('system 字段不存在时，提取的 system 消息创建新数组', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'new system' },
      ],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    expect(body.system).toEqual([
      { type: 'text', text: 'new system' },
    ]);
  });

  it('多条 system 角色消息按顺序提取', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'system 1' },
        { role: 'assistant', content: 'hi' },
        { role: 'system', content: 'system 2' },
        { role: 'user', content: 'world' },
      ],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'world' },
    ]);
    expect(body.system).toEqual([
      { type: 'text', text: 'system 1' },
      { type: 'text', text: 'system 2' },
    ]);
  });

  it('system 角色消息的 content 为数组时，提取文本内容', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'system',
          content: [
            { type: 'text', text: 'system block 1' },
            { type: 'text', text: 'system block 2' },
          ],
        },
      ],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    expect(body.system).toEqual([
      { type: 'text', text: 'system block 1' },
      { type: 'text', text: 'system block 2' },
    ]);
  });

  it('messages 为空数组时不修改', () => {
    const body: Record<string, unknown> = {
      messages: [],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([]);
    expect(body.system).toBeUndefined();
  });

  it('已有 system blocks 带 cache_control 时保留原字段', () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'extra system' },
      ],
      system: [
        { type: 'text', text: 'cached system', cache_control: { type: 'ephemeral' } },
      ],
    };
    extractSystemMessages(body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    // 已有 system blocks 中的 cache_control 保留
    expect(body.system).toEqual([
      { type: 'text', text: 'cached system', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'extra system' },
    ]);
  });
});
