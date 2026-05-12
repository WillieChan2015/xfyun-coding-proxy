export function extractTokenUsage(body: Record<string, unknown>): {
  promptTokens?: number;
  completionTokens?: number;
} {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (!usage) return {};

  return {
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    completionTokens:
      typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
  };
}

/**
 * 估算 Anthropic 输入 token 数
 * Anthropic 未开源 tokenizer，按官方经验值 1 token ≈ 4 字符估算
 * 遍历 messages + system + tools 中的所有文本内容
 */
export function estimateInputTokens(body: Record<string, unknown>): number {
  let chars = 0;

  // system 字段：字符串或内容块数组
  const system = body.system;
  if (typeof system === 'string') {
    chars += system.length;
  } else if (Array.isArray(system)) {
    chars += extractTextFromBlocks(system);
  }

  // messages 数组
  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const content = (msg as Record<string, unknown>).content;
      if (typeof content === 'string') {
        chars += content.length;
      } else if (Array.isArray(content)) {
        chars += extractTextFromBlocks(content);
      }
    }
  }

  // tools 数组：提取 name + description
  const tools = body.tools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      const t = tool as Record<string, unknown>;
      if (typeof t.name === 'string') chars += t.name.length;
      if (typeof t.description === 'string') chars += t.description.length;
    }
  }

  return Math.ceil(chars / 4);
}

/** 从 Anthropic 内容块数组中提取所有文本字符数 */
function extractTextFromBlocks(blocks: unknown[]): number {
  let chars = 0;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      chars += b.text.length;
    }
    // tool_result 中的 content 可能也是内容块数组
    if (b.type === 'tool_result' && Array.isArray(b.content)) {
      chars += extractTextFromBlocks(b.content);
    }
  }
  return chars;
}

export function fmtTokens(n: number): string {
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}k(${n.toLocaleString()})`;
  }
  return String(n);
}
