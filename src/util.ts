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

export function fmtTokens(n: number): string {
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}k(${n})`;
  }
  return String(n);
}
