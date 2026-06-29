import { Box, Text, useStdout } from 'ink';
import { fmtTokens } from '../util';

interface ProtocolUsage {
  name: string;
  tokens: number;
}

/** 精简格式化（不带具体值括号），用于 By Protocol / By Model 行 */
function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface TokenPanelProps {
  input: number;
  output: number;
  cached: number;
  todayTotal: number;
  todayCached: number;
  byProtocol: ProtocolUsage[];
  byModel: ProtocolUsage[];
}

export function TokenPanel({ input, output, cached, todayTotal, byProtocol, byModel }: TokenPanelProps) {
  const total = input + output;
  const { stdout } = useStdout();
  // 宽屏并排，窄屏上下（避免折行破坏结构）
  const wide = (stdout?.columns ?? 80) >= 80;
  const hasProtocol = byProtocol.length > 0;
  const hasModel = byModel.length > 0;
  const showSection = hasProtocol || hasModel;

  const protocolCol = hasProtocol ? (
    <Box flexDirection="column">
      <Text bold>  By Protocol:</Text>
      {byProtocol.map(({ name, tokens }) => (
        <Text key={name}>    {name}: {fmtTokensShort(tokens)}</Text>
      ))}
    </Box>
  ) : null;

  const modelCol = hasModel ? (
    <Box flexDirection="column">
      <Text bold>  By Model:</Text>
      {byModel.map(({ name, tokens }) => (
        <Text key={name}>    {name}: {fmtTokensShort(tokens)}</Text>
      ))}
    </Box>
  ) : null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Token Usage</Text>
      <Text>  Input:  {fmtTokens(input)}{cached > 0 ? ` (cached: ${fmtTokens(cached)})` : ''}</Text>
      <Text>  Output: {fmtTokens(output)}</Text>
      <Text>  Total:  {fmtTokens(total)}</Text>
      <Text>  Today:  {fmtTokens(todayTotal)}</Text>
      {showSection && (
        <Box flexDirection={wide ? 'row' : 'column'} marginTop={1} gap={4}>
          {protocolCol}
          {modelCol}
        </Box>
      )}
    </Box>
  );
}
