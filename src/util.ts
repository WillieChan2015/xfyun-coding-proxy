export function extractTokenUsage(body: Record<string, unknown>): {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
} {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (!usage) return {};

  // 从 prompt_tokens_details.cached_tokens 提取缓存命中 token 数
  let cachedTokens: number | undefined;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  if (promptDetails && typeof promptDetails.cached_tokens === 'number' && promptDetails.cached_tokens > 0) {
    cachedTokens = promptDetails.cached_tokens;
  }

  return {
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    completionTokens:
      typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    cachedTokens,
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

/**
 * 带超时的 ReadableStream 读取
 *
 * ReadableStreamDefaultReader.read() 无原生超时参数，
 * 上游在流中间停止发送数据（但未关闭连接）时，read() 会无限挂起。
 * 用 Promise.race 给每次 read 加超时保护，超时后抛出 TimeoutError。
 *
 * @param reader - ReadableStream 的 reader
 * @param timeoutMs - 单次 read 最长等待毫秒数
 */
export async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout>;
  const readPromise = reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error(
        `stream read timeout: no data received for ${timeoutMs}ms, ` +
        'upstream may have stalled (large input causing long prefill, or network idle timeout)',
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * 带大小限制的响应体读取
 *
 * 原生 response.text() 无大小限制，上游异常返回超大 body 会吃掉内存。
 * 通过流式读取 + 字节计数，超过 maxSize 时中止并抛错。
 */
export async function readBodyWithLimit(
  response: Response,
  maxSize: number = 1_048_576, // 1MB，与 Fastify bodyLimit 一致
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new Error(`response body too large: Content-Length ${contentLength} exceeds limit ${maxSize}`);
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxSize) {
        throw new Error(`response body too large: exceeded ${maxSize} bytes (read ${totalBytes})`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // 合并 chunks 并解码
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/**
 * 从请求中提取白名单 headers，用于转发到上游
 *
 * 三个 handler（OpenAI/Anthropic/Ollama）都需要从客户端请求中
 * 提取 Authorization 等关键 headers 转发给上游，此函数统一该逻辑。
 */
export function extractUpstreamHeaders(
  reqHeaders: Record<string, string | string[] | undefined>,
  allowedHeaders: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of allowedHeaders) {
    const value = reqHeaders[key.toLowerCase()];
    if (typeof value === 'string' && value) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 格式化 token 数量为可读字符串
 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M(${n.toLocaleString()})`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k(${n.toLocaleString()})`;
  return String(n);
}
