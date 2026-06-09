/** Ollama /api/chat 请求体 */
export interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    images?: string[];
    tool_calls?: OllamaToolCall[];
  }>;
  stream?: boolean;
  format?: string | Record<string, unknown>;
  options?: OllamaOptions;
  keep_alive?: string | number;
  tools?: OllamaTool[];
  think?: boolean | string;
  logprobs?: boolean;
  top_logprobs?: number;
}

/** Ollama /api/generate 请求体 */
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: number[];
  stream?: boolean;
  format?: string | Record<string, unknown>;
  options?: OllamaOptions;
  keep_alive?: string | number;
  images?: string[];
  think?: boolean | string;
}

/** Ollama options 参数包 */
export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
  num_predict?: number;
  num_batch?: number;
  seed?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
}

/** Ollama tool 定义 */
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Ollama tool call */
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/** Ollama /api/chat 非流式响应 */
export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: true;
  done_reason: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Ollama /api/generate 非流式响应 */
export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: true;
  done_reason: string;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Ollama /api/chat 流式增量行 */
export interface OllamaChatChunk {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Ollama /api/generate 流式增量行 */
export interface OllamaGenerateChunk {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  done_reason?: string;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Ollama /api/tags 响应 */
export interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
      parent_model: string;
      format: string;
      family: string;
      parameter_size: string;
      quantization_level: string;
    };
  }>;
}

/** Ollama 错误响应 */
export interface OllamaErrorResponse {
  error: string;
}

/** Ollama 端点类型标识 */
export type OllamaEndpoint = 'chat' | 'generate';
