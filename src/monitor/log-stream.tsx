import { Box, Text } from 'ink';
import { fmtTokens } from '../util';

export interface LogEntry {
  time: string;
  method: string;
  path: string;
  protocol: string;
  model: string;
  latencyMs: number;
  tokens: number;
  success: boolean;
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
          {entry.success
            ? `${entry.time} ${entry.method} ${entry.path}  ${entry.protocol}  ${(entry.latencyMs / 1000).toFixed(1)}s  ${fmtTokens(entry.tokens)}`
            : `${entry.time} ERR  ${entry.path}  ${entry.protocol}  ${entry.latencyMs}ms`
          }
        </Text>
      ))}
      {entries.length === 0 && <Text dimColor>  No requests yet...</Text>}
    </Box>
  );
}
