import { Box, Text } from 'ink';

interface RequestPanelProps {
  active: number;
  streaming: number;
  totalToday: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export function RequestPanel({ active, streaming, totalToday, avgLatencyMs, p95LatencyMs }: RequestPanelProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Requests</Text>
      <Text>  Active:    {active}</Text>
      <Text>  Streaming: {streaming}</Text>
      <Text>  Today:     {totalToday}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>  Avg Latency: {(avgLatencyMs / 1000).toFixed(1)}s</Text>
        <Text>  P95 Latency: {(p95LatencyMs / 1000).toFixed(1)}s</Text>
      </Box>
    </Box>
  );
}
