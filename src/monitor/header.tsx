import { Box, Text } from 'ink';

interface HeaderProps {
  name: string;
  version: string;
  requestsPerMin: number;
  successRate: number;
  port: number;
  baseUrl: string;
  anthropicBaseUrl: string;
}

/** 从完整 URL 中提取 host 部分，如 https://maas-coding-api.cn-huabei-1.xf-yun.com/v2 → maas-coding-api.cn-huabei-1.xf-yun.com */
function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function Header({ name, version, requestsPerMin, successRate, port, baseUrl, anthropicBaseUrl }: HeaderProps) {
  const rateColor = successRate >= 99 ? 'green' : successRate >= 95 ? 'yellow' : 'red';
  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text bold>{name} v{version}</Text>
        <Text>↑ {requestsPerMin}/min</Text>
        <Text color={rateColor}>{successRate.toFixed(1)}% OK</Text>
      </Box>
    </Box>
  );
}
