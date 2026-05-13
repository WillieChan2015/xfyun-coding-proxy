import { Box, Text } from 'ink';
import { fmtTokens } from '../util';

export interface LogEntry {
  time: string;
  timestamp: number;
  method: string;
  path: string;
  protocol: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  pending?: boolean;
  requestId?: string;
  ua?: string;
}

interface LogStreamProps {
  entries: LogEntry[];
  maxVisible?: number;
  scrollOffset: number;
}

export function LogStream({ entries, maxVisible = 8, scrollOffset }: LogStreamProps) {
  const start = Math.max(0, entries.length - maxVisible - scrollOffset);
  const visible = entries.slice(start, start + maxVisible);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Recent Requests</Text>
      {visible.map((entry, i) => (
        <Text key={i}>
          {entry.pending
            ? `${entry.time} ${entry.requestId ?? '-'} ${entry.method} ${entry.path} - ${entry.model} | ua=${entry.ua ?? 'unknown'} | processing... ${((Date.now() - entry.timestamp) / 1000).toFixed(1)}s`
            : entry.success
              ? `${entry.time} ${entry.requestId ?? '-'} ${entry.method} ${entry.path} - ${entry.model} | ${(entry.latencyMs / 1000).toFixed(1)}s | in=${fmtTokens(entry.inputTokens)} out=${fmtTokens(entry.outputTokens)} total=${fmtTokens(entry.inputTokens + entry.outputTokens)} | ua=${entry.ua ?? 'unknown'}`
              : `${entry.time} ${entry.requestId ?? '-'} ERR  ${entry.path} - ${entry.model} | ${entry.latencyMs}ms | ua=${entry.ua ?? 'unknown'}`
          }
        </Text>
      ))}
      {entries.length === 0 && <Text dimColor>  No requests yet...</Text>}
    </Box>
  );
}
