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
  stream?: boolean;
  pending?: boolean;
  requestId?: string;
  ua?: string;
  error?: string;
}

export type LogTab = 'all' | 'errors';

interface LogStreamProps {
  entries: LogEntry[];
  errorCount: number;
  maxVisible?: number;
  scrollOffset: number;
  tab: LogTab;
}

export function LogStream({ entries, errorCount, maxVisible = 8, scrollOffset, tab }: LogStreamProps) {
  const filtered = tab === 'errors' ? entries.filter(e => !e.success) : entries;
  const start = Math.max(0, filtered.length - maxVisible - scrollOffset);
  const visible = filtered.slice(start, start + maxVisible);
  const hasMoreAbove = start > 0;
  const hasMoreBelow = start + maxVisible < filtered.length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text
          bold={tab === 'all'}
          color={tab === 'all' ? 'cyan' : undefined}
          inverse={tab === 'all'}
        > Recent Requests </Text>
        <Text> </Text>
        <Text
          bold={tab === 'errors'}
          color={tab === 'errors' ? 'red' : undefined}
          inverse={tab === 'errors'}
        >{` Errors${errorCount > 0 ? `(${errorCount})` : ''} `}</Text>
      </Box>
      {hasMoreAbove && <Text dimColor>  ↑ ↑ ↑ {start} more above</Text>}
      {visible.map((entry, i) => {
        const tag = entry.success ? entry.method : 'ERR';
        const head = `${entry.time} ${entry.requestId ?? '-'} ${tag} ${entry.path} - ${entry.model} | stream=${entry.stream ?? '?'}`;
        const tail = entry.pending
          ? `| ua=${entry.ua ?? 'unknown'} | processing... ${((Date.now() - entry.timestamp) / 1000).toFixed(1)}s`
          : entry.success
            ? `| ${(entry.latencyMs / 1000).toFixed(1)}s | in=${fmtTokens(entry.inputTokens)} out=${fmtTokens(entry.outputTokens)} total=${fmtTokens(entry.inputTokens + entry.outputTokens)} | ua=${entry.ua ?? 'unknown'}`
            : `| ${entry.latencyMs}ms | ${entry.error ?? 'unknown error'} | ua=${entry.ua ?? 'unknown'}`;
        return <Text key={i} color={!entry.success ? 'red' : undefined}>{head} {tail}</Text>;
      })}
      {hasMoreBelow && <Text dimColor>  ↓ ↓ ↓ {filtered.length - start - maxVisible} more below</Text>}
      {filtered.length === 0 && <Text dimColor>  {tab === 'errors' ? 'No errors' : 'No requests yet...'}</Text>}
    </Box>
  );
}
