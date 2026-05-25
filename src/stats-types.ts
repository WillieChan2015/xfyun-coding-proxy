/** 会话级每日统计 */
export interface SessionDayStats {
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
}

/** 协议级统计 */
export interface ProtocolStats {
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
}

/** 每日统计 */
export interface DailyStats {
  date: string;
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retries: number;
  errors: number;
  protocols: Record<string, ProtocolStats>;
}

/** 协议类型 */
export type Protocol = 'openai' | 'anthropic' | 'ollama';

/** 请求完成事件 */
export interface RequestCompleteEvent {
  protocol: Protocol;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  retries: number;
  stream?: boolean;
  requestId?: string;
  path?: string;
  ua?: string;
  error?: string;
}

/** 请求日志条目 */
export interface RequestLogEntry {
  timestamp: number;
  method: string;
  path: string;
  protocol: Protocol;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  stream?: boolean;
  pending?: boolean;
  requestId?: string;
  ua?: string;
  error?: string;
}
