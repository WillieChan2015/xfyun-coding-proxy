import { Box, Text } from 'ink';

interface HeaderProps {
  name: string;
  version: string;
  requestsPerMin: number;
  successRate: number;
}

export function Header({ name, version, requestsPerMin, successRate }: HeaderProps) {
  const rateColor = successRate >= 99 ? 'green' : successRate >= 95 ? 'yellow' : 'red';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text bold>{name} v{version}</Text>
      <Text>↑ {requestsPerMin}/min</Text>
      <Text color={rateColor}>{successRate.toFixed(1)}% OK</Text>
    </Box>
  );
}
