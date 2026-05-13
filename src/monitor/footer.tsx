import { Box, Text } from 'ink';

export function Footer() {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text dimColor>q: quit</Text>
      <Text dimColor>↑/↓: scroll logs</Text>
      <Text dimColor>r: reset</Text>
    </Box>
  );
}
