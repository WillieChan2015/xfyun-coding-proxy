/**
 * 将 messages 数组中 role: "system" 的消息就地提取到 system 字段
 * Claude Code 2.1.156+ 启用 mid-conversation-system beta 后，
 * 会在 messages 中插入 system 角色消息，讯飞 API 不支持此格式
 */

/** 将 system 角色消息的 content 统一转为 Anthropic system 字段的数组格式 */
function systemContentToBlocks(
  content: string | Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  // 数组中只取 type: "text" 的块，过滤掉 tool_use 等非文本块
  return content.filter(
    (block) => block.type === 'text' && typeof block.text === 'string',
  );
}

/**
 * 就地修改 body：将 messages 中 role: "system" 的消息提取到 system 字段
 * 无 system 角色消息时不做任何修改
 */
export function extractSystemMessages(
  body: Record<string, unknown>,
): void {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages || messages.length === 0) return;

  const systemMsgs: Array<Record<string, unknown>> = [];
  const remaining: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const blocks = systemContentToBlocks(
        msg.content as string | Array<Record<string, unknown>>,
      );
      systemMsgs.push(...blocks);
    } else {
      remaining.push(msg);
    }
  }

  // 没有 system 角色消息，无需修改
  if (systemMsgs.length === 0) return;

  // 合并到已有 system 字段
  const existingSystem = body.system;
  let mergedSystem: Array<Record<string, unknown>>;

  if (!existingSystem) {
    mergedSystem = systemMsgs;
  } else if (typeof existingSystem === 'string') {
    mergedSystem = [{ type: 'text', text: existingSystem }, ...systemMsgs];
  } else {
    // 已有 system 是数组，追加
    mergedSystem = [
      ...(existingSystem as Array<Record<string, unknown>>),
      ...systemMsgs,
    ];
  }

  body.messages = remaining;
  body.system = mergedSystem;
}