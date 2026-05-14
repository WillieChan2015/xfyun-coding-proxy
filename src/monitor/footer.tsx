import { Box, Text } from 'ink';
import { LogTab } from './log-stream';

interface FooterProps {
  logTab: LogTab;
}

export function Footer({ logTab }: FooterProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text dimColor>q: quit</Text>
      <Text dimColor>↑/↓: scroll</Text>
      <Text dimColor>←/→: page</Text>
      <Text dimColor>e: {logTab === 'all' ? 'errors' : 'all logs'}</Text>
      <Text dimColor>r: reset</Text>
    </Box>
  );
}
