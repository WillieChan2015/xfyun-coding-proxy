import { Box, Text } from 'ink';
import { fmtTokens } from '../util';

interface ProtocolUsage {
  name: string;
  tokens: number;
}

interface TokenPanelProps {
  input: number;
  output: number;
  byProtocol: ProtocolUsage[];
}

export function TokenPanel({ input, output, byProtocol }: TokenPanelProps) {
  const total = input + output;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Token Usage</Text>
      <Text>  Input:  {fmtTokens(input)}</Text>
      <Text>  Output: {fmtTokens(output)}</Text>
      <Text>  Total:  {fmtTokens(total)}</Text>
      {byProtocol.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>  By Protocol:</Text>
          {byProtocol.map(({ name, tokens }) => (
            <Text key={name}>    {name}: {fmtTokens(tokens)}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
