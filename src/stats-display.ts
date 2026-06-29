import { fmtTokens } from './util';
import { todayStr, formatStatsLine, formatDate } from './stats-store';
import { loadDailyStats, listStatsDates } from './stats-persistence';
import type { DailyStats } from './stats-types';
import { sessionStats, dailyStats } from './stats-store';

// ---- 格式化工具函数 ----

function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const days = Math.floor(hr / 24);
  return `${days}d ${hr % 24}h ${min % 60}m`;
}

// ---- 显示函数 ----

export function printDailyStats(date: string, stats: DailyStats | null): void {
  if (!stats) {
    console.log(`No stats available for ${date}`);
    return;
  }
  const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log(`  Daily Stats — ${date}`);
  console.log('════════════════════════════════════════════════');
  console.log(`  Requests:       ${stats.requestCount}`);
  console.log(`  Tokens:         ${fmtTokens(totalTokens)}`);
  console.log(`    Input:        ${fmtTokens(stats.totalPromptTokens)}`);
  console.log(`    Output:       ${fmtTokens(stats.totalCompletionTokens)}`);
  console.log(`    Cached:       ${fmtTokens(stats.totalCachedTokens)}`);
  console.log(`  Retries:        ${stats.retries}`);
  console.log(`  Errors:         ${stats.errors}`);
  const protocolKeys = Object.keys(stats.protocols);
  if (protocolKeys.length > 0) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Protocol:');
    const sorted = protocolKeys.sort((a, b) => stats.protocols[b].requestCount - stats.protocols[a].requestCount);
    for (const name of sorted) {
      const p = stats.protocols[name];
      console.log(formatStatsLine(name, p));
    }
  }
  console.log('════════════════════════════════════════════════');
  console.log('');
}

export function printStatsHistory(logDir: string): void {
  const dates = listStatsDates(logDir);
  if (dates.length === 0) {
    console.log('No usage history found');
    return;
  }
  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  Usage History');
  console.log('════════════════════════════════════════════════');
  console.log('  Date         Requests   Tokens              Protocols');
  for (const date of dates) {
    const stats = loadDailyStats(logDir, date);
    if (!stats) continue;
    const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
    const dateStr = date.padEnd(12);
    const reqStr = String(stats.requestCount).padEnd(10);
    const tokStr = fmtTokens(totalTokens).padEnd(20);
    const protocolKeys = Object.keys(stats.protocols);
    const protocolsStr = protocolKeys.length > 0
      ? protocolKeys.sort((a, b) => stats.protocols[b].requestCount - stats.protocols[a].requestCount)
          .map(name => `${name}(${stats.protocols[name].requestCount})`)
          .join(' ')
      : '-';
    console.log(`  ${dateStr}${reqStr}${tokStr}${protocolsStr}`);
  }
  console.log('════════════════════════════════════════════════');
  console.log('');
}

export function printSessionSummary(): void {
  const uptime = Date.now() - sessionStats.startTime;
  const totalTokens = sessionStats.totalPromptTokens + sessionStats.totalCompletionTokens;
  const startDateStr = formatDate(new Date(sessionStats.startTime));
  const today = todayStr();
  const dateRange = startDateStr === today ? startDateStr : `${startDateStr} ~ ${today}`;

  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  Session Summary');
  console.log('════════════════════════════════════════════════');
  console.log(`  Date:           ${dateRange}`);
  console.log(`  Requests:       ${sessionStats.requestCount}`);
  console.log(`  Tokens:         ${fmtTokens(totalTokens)}`);
  console.log(`    Input:        ${fmtTokens(sessionStats.totalPromptTokens)}`);
  console.log(`    Output:       ${fmtTokens(sessionStats.totalCompletionTokens)}`);
  console.log(`    Cached:       ${fmtTokens(sessionStats.totalCachedTokens)}`);
  console.log(`  Retries:        ${sessionStats.retries}`);
  console.log(`  Errors:         ${sessionStats.errors}`);
  console.log(`  Uptime:         ${fmtUptime(uptime)}`);

  // By Day 分日明细（跨天时展示每日贡献）
  const byDateKeys = Object.keys(sessionStats.byDate).sort();
  if (byDateKeys.length > 1) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Day:');
    for (const date of byDateKeys) {
      const d = sessionStats.byDate[date];
      console.log(formatStatsLine(date, d, 10));
    }
  }

  const sessionProtocolKeys = Object.keys(sessionStats.protocols);
  if (sessionProtocolKeys.length > 0) {
    console.log('──────────────────────────────────────────────────');
    console.log('  By Protocol:');
    const sorted = sessionProtocolKeys.sort((a, b) => sessionStats.protocols[b].requestCount - sessionStats.protocols[a].requestCount);
    for (const name of sorted) {
      const p = sessionStats.protocols[name];
      console.log(formatStatsLine(name, p));
    }
  }

  // Today 部分：仅单日运行且有实际数据时展示；
  // 跨天时 By Day 已包含今天的明细，Today 的 cumulative 语义（含历史实例数据）容易混淆，故隐藏
  if (byDateKeys.length <= 1 && dailyStats.date && dailyStats.requestCount > 0) {
    const totalDailyTokens = dailyStats.totalPromptTokens + dailyStats.totalCompletionTokens;
    console.log('──────────────────────────────────────────────────');
    console.log(`  Today (${dailyStats.date})`);
    console.log(`  Requests:       ${dailyStats.requestCount}`);
    console.log(`  Tokens:         ${fmtTokens(totalDailyTokens)}`);
    console.log(`    Input:        ${fmtTokens(dailyStats.totalPromptTokens)}`);
    console.log(`    Output:       ${fmtTokens(dailyStats.totalCompletionTokens)}`);
    console.log(`    Cached:       ${fmtTokens(dailyStats.totalCachedTokens)}`);
    console.log(`  Retries:        ${dailyStats.retries}`);
    console.log(`  Errors:         ${dailyStats.errors}`);
    const todayProtocolKeys = Object.keys(dailyStats.protocols);
    if (todayProtocolKeys.length > 0) {
      console.log('    By Protocol:');
      const sorted = todayProtocolKeys.sort((a, b) => dailyStats.protocols[b].requestCount - dailyStats.protocols[a].requestCount);
      for (const name of sorted) {
        const p = dailyStats.protocols[name];
        console.log(formatStatsLine(name, p));
      }
    }
  }

  console.log('════════════════════════════════════════════════');
  console.log('');
}
