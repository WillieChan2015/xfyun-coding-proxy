/**
 * Anthropic Messages API 类型定义（最小化）
 * 仅定义代理层需要用到的类型：请求体（用于 model 覆盖）和 SSE 事件白名单
 */

/** Anthropic Messages API 请求体（代理层关注的字段） */
export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string | Array<Record<string, unknown>>;
  }>;
  system?: string | Array<Record<string, unknown>>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
  thinking?: Record<string, unknown>;
  metadata?: { user_id?: string };
}

/** Anthropic SSE 标准事件类型白名单
 * 包含 error：Anthropic 官方协议支持 event: error 事件，
 * 且讯飞引擎在上下文超长、额度不足等场景通过 SSE error 返回错误。
 * 不包含 error 会导致 SSEFilter 过滤掉错误事件，客户端收到空 SSE 流，
 * 触发 "empty or malformed response (HTTP 200)" 错误。
 */
export const ANTHROPIC_SSE_EVENTS = new Set([
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
  'ping',
  'error',
]);

/** Anthropic 响应中的 token 用量 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Anthropic 非流式响应（代理层关注的字段） */
export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<Record<string, unknown>>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

/** Anthropic 错误响应 */
export interface AnthropicErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
  request_id?: string;
}
