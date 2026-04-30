import { fmtTokens } from './util';

export const sessionStats = {
  requestCount: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  retries: 0,
  errors: 0,
  startTime: Date.now(),
};

function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function printSessionSummary(): void {
  const uptime = Date.now() - sessionStats.startTime;
  const totalTokens = sessionStats.totalPromptTokens + sessionStats.totalCompletionTokens;

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  Session Summary');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Requests:       ${sessionStats.requestCount}`);
  console.log(`  Tokens:         ${fmtTokens(totalTokens)}`);
  console.log(`    Input:        ${fmtTokens(sessionStats.totalPromptTokens)}`);
  console.log(`    Output:       ${fmtTokens(sessionStats.totalCompletionTokens)}`);
  console.log(`  Retries:        ${sessionStats.retries}`);
  console.log(`  Errors:         ${sessionStats.errors}`);
  console.log(`  Uptime:         ${fmtUptime(uptime)}`);
  console.log('══════════════════════════════════════════════════');
  console.log('');
}
