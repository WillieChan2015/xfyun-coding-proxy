/** OpenAI chat completion 请求体（代理实际使用的字段） */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export type ToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI chat completion 非流式响应 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionResponseMessage;
  finish_reason: string | null;
}

export interface ChatCompletionResponseMessage {
  role: 'assistant';
  content: string | null;
  reasoning_content?: string;
  plugins_content?: string;
  tool_calls?: ToolCall[];
}

/** OpenAI chat completion 流式 chunk */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: UsageInfo;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: string; content?: string; tool_calls?: ToolCall[] };
  finish_reason: string | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export function isChatCompletionRequest(value: unknown): value is ChatCompletionRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.model === 'string' && Array.isArray(obj.messages);
}

export function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.object === 'chat.completion' &&
    typeof obj.created === 'number' &&
    typeof obj.model === 'string' &&
    Array.isArray(obj.choices)
  );
}

export function isUsageInfo(value: unknown): value is UsageInfo {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.prompt_tokens === 'number' &&
    typeof obj.completion_tokens === 'number' &&
    typeof obj.total_tokens === 'number'
  );
}
