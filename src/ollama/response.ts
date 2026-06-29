import { SUPPORTED_MODELS, DEFAULT_MODEL } from '../config';
import type { OllamaEndpoint } from './types';

/** 支持思考深度选择的模型 ID 集合（xopdeepseekv4pro / xopdeepseekv4flash / xopglm52） */
const THINKING_DEPTH_MODELS = new Set(['xopdeepseekv4pro', 'xopdeepseekv4flash', 'xopglm52']);

/**
 * 将 OpenAI 非流式 chat completion 响应转换为 Ollama /api/chat 响应
 * @param model 解析后的模型 ID
 */
export function convertChatResponse(openai: Record<string, unknown>, model: string): Record<string, unknown> {
  const choices = openai.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const usage = openai.usage as Record<string, unknown> | undefined;

  return {
    model,
    created_at: new Date().toISOString(),
    message: message ?? { role: 'assistant', content: '' },
    done: true,
    done_reason: (choice?.finish_reason as string) ?? 'stop',
    ...(usage?.prompt_tokens !== undefined ? { prompt_eval_count: usage.prompt_tokens as number } : {}),
    ...(usage?.completion_tokens !== undefined ? { eval_count: usage.completion_tokens as number } : {}),
  };
}

/**
 * 将 OpenAI 非流式 chat completion 响应转换为 Ollama /api/generate 响应
 * 用 response（纯文本）替代 message（对象）
 * @param model 解析后的模型 ID
 */
export function convertGenerateResponse(openai: Record<string, unknown>, model: string): Record<string, unknown> {
  const choices = openai.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const usage = openai.usage as Record<string, unknown> | undefined;

  return {
    model,
    created_at: new Date().toISOString(),
    response: (message?.content as string) ?? '',
    done: true,
    done_reason: (choice?.finish_reason as string) ?? 'stop',
    ...(usage?.prompt_tokens !== undefined ? { prompt_eval_count: usage.prompt_tokens as number } : {}),
    ...(usage?.completion_tokens !== undefined ? { eval_count: usage.completion_tokens as number } : {}),
  };
}

/**
 * 从 SUPPORTED_MODELS 本地生成 Ollama /api/tags 响应
 * 讯飞上游 /v2/models 返回空数组，不再请求上游，改为本地生成
 */
export function convertTagsResponse(): { models: Array<Record<string, unknown>> } {
  // 默认模型始终在首位
  const defaultModel = {
    name: DEFAULT_MODEL,
    model: DEFAULT_MODEL,
    modified_at: new Date().toISOString(),
    size: 0,
    digest: '',
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'astron',
      parameter_size: '',
      quantization_level: '',
    },
  };
  const supportedModels = SUPPORTED_MODELS.map((m) => {
    const hasThinkingDepth = THINKING_DEPTH_MODELS.has(m.id);
    return {
      // name: VSCode 等工具在模型列表中显示的名字，用人类可读的展示名而非原始 ID
      name: m.name,
      // model: 实际用于 API 请求的模型 ID，保持与讯飞上游一致
      model: m.id,
      modified_at: new Date().toISOString(),
      size: 0,
      digest: '',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'astron',
        parameter_size: String(m.contextLength),
        quantization_level: '',
        // 声明支持思考深度选择的级别，供客户端（VSCode、Open WebUI 等）在模型列表中展示
        ...(hasThinkingDepth ? { thinking_levels: ['high', 'max'] } : {}),
      },
    };
  });
  return { models: [defaultModel, ...supportedModels] };
}

/**
 * 将 OpenAI 错误格式转换为 Ollama 错误格式
 * OpenAI: { error: { message, type, code } } → Ollama: { error: "message" }
 */
export function convertErrorToOllama(openai: Record<string, unknown>): { error: string } {
  const error = openai.error as Record<string, unknown> | undefined;
  return { error: (error?.message as string) ?? 'Unknown error' };
}

/**
 * SSE → NDJSON 流式转换器
 * 将 OpenAI SSE 格式的流式响应转换为 Ollama NDJSON 格式
 */
export class SSEToNDJSONConverter {
  private endpoint: OllamaEndpoint;
  private model: string;

  constructor(endpoint: OllamaEndpoint, model: string) {
    this.endpoint = endpoint;
    this.model = model;
  }

  /**
   * 将一段 SSE 文本转换为 NDJSON 行数组
   * 输入: 过滤后的 SSE 文本（已由 SSEFilter 处理）
   * 输出: 每行是一个完整的 Ollama NDJSON 行（不含换行符）
   */
  convert(sseText: string): string[] {
    const lines: string[] = [];
    if (!sseText) return lines;

    // 按行解析 SSE 文本
    const sseLines = sseText.split('\n');
    for (const line of sseLines) {
      // 只处理 data: 行
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();

      // 跳过 [DONE]
      if (data === '[DONE]') continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
      const choice = choices?.[0];
      if (!choice) continue;

      const delta = choice.delta as Record<string, unknown> | undefined;
      const content = (delta?.content as string) ?? null;
      const finishReason = choice.finish_reason as string | undefined;
      const usage = parsed.usage as Record<string, unknown> | undefined;

      // 有内容时先输出内容行
      if (content !== null && content !== '') {
        lines.push(this.buildChunk(content, false));
      }

      // 有 finish_reason 时输出结束行
      if (finishReason) {
        lines.push(this.buildDoneChunk(finishReason, usage));
      }

      // content 为空字符串且无 finish_reason 时（空 delta），跳过
    }

    return lines;
  }

  /** 构建增量内容 NDJSON 行（done: false） */
  private buildChunk(content: string, done: boolean): string {
    const base = {
      model: this.model,
      created_at: new Date().toISOString(),
      done,
    };

    if (this.endpoint === 'chat') {
      return JSON.stringify({ ...base, message: { role: 'assistant', content } });
    }
    return JSON.stringify({ ...base, response: content });
  }

  /** 构建结束 NDJSON 行（done: true），附带 done_reason 和 token 用量 */
  private buildDoneChunk(doneReason: string, usage?: Record<string, unknown>): string {
    const base: Record<string, unknown> = {
      model: this.model,
      created_at: new Date().toISOString(),
      done: true,
      done_reason: doneReason,
    };

    if (usage) {
      if (usage.prompt_tokens !== undefined) base.prompt_eval_count = usage.prompt_tokens;
      if (usage.completion_tokens !== undefined) base.eval_count = usage.completion_tokens;
    }

    if (this.endpoint === 'chat') {
      return JSON.stringify({ ...base, message: { role: 'assistant', content: '' } });
    }
    return JSON.stringify({ ...base, response: '' });
  }
}

/**
 * 构建 Ollama /api/show 响应
 * 根据请求的 model 返回对应的元信息和能力声明（如思考深度选项）
 */
export function buildShowResponse(modelId: string): Record<string, unknown> {
  const modelInfo = SUPPORTED_MODELS.find(m => m.id === modelId);
  const contextLength = modelInfo?.contextLength ?? 192000;
  const hasThinkingDepth = THINKING_DEPTH_MODELS.has(modelId);

  return {
    modified_at: new Date().toISOString(),
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'astron',
      families: ['astron'],
      parameter_size: '',
      quantization_level: '',
    },
    capabilities: ['completion', 'tools', ...(hasThinkingDepth ? ['thinking'] : [])],
    model_info: {
      'general.architecture': 'astron',
      'astron.context_length': contextLength,
      'general.parameter_count': 0,
      ...(hasThinkingDepth ? {
        'astron.thinking_levels': ['high', 'max'],
      } : {}),
    },
  };
}
