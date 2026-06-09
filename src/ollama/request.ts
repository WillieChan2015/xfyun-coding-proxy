import type { OllamaChatRequest, OllamaGenerateRequest, OllamaOptions } from './types';

/** 支持思考深度选择的模型 ID 集合（xopdeepseekv4pro / xopdeepseekv4flash） */
const THINKING_DEPTH_MODELS = new Set(['xopdeepseekv4pro', 'xopdeepseekv4flash']);

/**
 * 将 Ollama think 参数转换为讯飞上游的 thinking_level 参数
 * - think: "high" / true → { thinking_level: "high" }
 * - think: "max" → { thinking_level: "max" }
 * - 其他值 → 不传 thinking_level（使用模型默认值）
 * 仅当 model 在 THINKING_DEPTH_MODELS 中时才生效
 */
function mapThinkToThinkingLevel(
  think: boolean | string | undefined,
  model: string,
): Record<string, unknown> {
  if (think === undefined || think === false) return {};
  if (!THINKING_DEPTH_MODELS.has(model)) return {};

  if (think === true || think === 'high') {
    return { thinking_level: 'high' };
  }
  if (think === 'max') {
    return { thinking_level: 'max' };
  }
  // think 为其他字符串值（如 "low"）时，不传 thinking_level
  return {};
}

/**
 * 将 Ollama format 字段映射为 OpenAI response_format
 * - format: "json" → { type: "json_object" }
 * - format: { JSON Schema } → { type: "json_schema", json_schema: ... }
 * - undefined → undefined
 */
export function mapFormat(
  format: string | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (format === undefined) return undefined;
  if (format === 'json') return { type: 'json_object' };
  return { type: 'json_schema', json_schema: format };
}

/**
 * 从 Ollama options 参数包中提取 OpenAI 顶层参数
 * 不支持的选项（top_k, num_ctx, num_batch）静默丢弃
 */
function liftOptions(options: OllamaOptions | undefined): Record<string, unknown> {
  if (!options) return {};
  const result: Record<string, unknown> = {};
  if (options.temperature !== undefined) result.temperature = options.temperature;
  if (options.top_p !== undefined) result.top_p = options.top_p;
  if (options.num_predict !== undefined) result.max_tokens = options.num_predict;
  if (options.seed !== undefined) result.seed = options.seed;
  if (options.stop !== undefined) result.stop = options.stop;
  if (options.frequency_penalty !== undefined) result.frequency_penalty = options.frequency_penalty;
  if (options.presence_penalty !== undefined) result.presence_penalty = options.presence_penalty;
  return result;
}

/**
 * 将 Ollama /api/chat 请求转换为 OpenAI /v1/chat/completions 请求
 */
/**
 * 将 Ollama /api/chat 请求转换为 OpenAI /v1/chat/completions 请求
 * @param ollama Ollama 请求体
 * @param model 解析后的模型 ID（由 resolveModelId 得到）
 */
export function convertChatRequest(ollama: OllamaChatRequest, model: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model,
    messages: ollama.messages,
    ...liftOptions(ollama.options),
    ...mapThinkToThinkingLevel(ollama.think, model),
  };

  if (ollama.stream !== undefined) result.stream = ollama.stream;
  if (ollama.format !== undefined) result.response_format = mapFormat(ollama.format);
  if (ollama.tools !== undefined) result.tools = ollama.tools;
  if (ollama.logprobs !== undefined) result.logprobs = ollama.logprobs;
  if (ollama.top_logprobs !== undefined) result.top_logprobs = ollama.top_logprobs;

  return result;
}

/**
 * 将 Ollama /api/generate 请求转换为 OpenAI /v1/chat/completions 请求
 * prompt → messages, system → system message, template/context 丢弃
 * @param ollama Ollama 请求体
 * @param model 解析后的模型 ID（由 resolveModelId 得到）
 */
export function convertGenerateRequest(ollama: OllamaGenerateRequest, model: string): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (ollama.system) {
    messages.push({ role: 'system', content: ollama.system });
  }
  messages.push({ role: 'user', content: ollama.prompt });

  const result: Record<string, unknown> = {
    model,
    messages,
    ...liftOptions(ollama.options),
    ...mapThinkToThinkingLevel(ollama.think, model),
  };

  if (ollama.stream !== undefined) result.stream = ollama.stream;
  if (ollama.format !== undefined) result.response_format = mapFormat(ollama.format);

  return result;
}
