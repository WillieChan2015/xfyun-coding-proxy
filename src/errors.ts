/** 上游返回非 2xx 状态码 */
export class UpstreamError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`upstream returned ${status}`);
    this.name = 'UpstreamError';
  }
}

/** 流式传输中断 */
export class StreamInterruptedError extends Error {
  constructor(
    public reason: string,
  ) {
    super(`stream interrupted: ${reason}`);
    this.name = 'StreamInterruptedError';
  }
}

/** 网络层异常 */
export class NetworkError extends Error {
  constructor(
    public cause: Error,
  ) {
    super(`network error: ${cause.message}`);
    this.name = 'NetworkError';
  }
}

/** OpenAI 格式错误响应 */
export function formatOpenAIError(status: number, message: string, code?: string | number) {
  return { error: { message, type: 'upstream_error', code: code ?? status } };
}

/** Anthropic 格式错误响应 */
export function formatAnthropicError(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}
