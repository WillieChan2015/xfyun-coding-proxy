import { fmtTokens } from './util';
import { todayStr, formatStatsLine, formatDate } from './stats-store';
import { loadDailyStats, listStatsDates } from './stats-persistence';
import type { DailyStats } from './stats-types';
import { sessionStats } from './stats-store';

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

/** 计算错误率百分比：errors / requestCount * 100，requestCount=0 时返回 0 */
function errorRate(errors: number, requestCount: number): string {
  if (requestCount <= 0) return '0.0';
  return ((errors / requestCount) * 100).toFixed(1);
}

/** 表格行数据：name + 各统计列的格式化字符串 */
interface StatsTableRow {
  name: string;
  requests: string;
  input: string;
  output: string;
  cached: string;
  errors: string;
}

/**
 * 渲染统计明细为对齐表格（带表头 + 分隔线），替代逐行 formatStatsLine 输出。
 * 列宽按表头与各行内容动态计算，保证中英文混合时仍对齐。
 * @param indent - 表格缩进空格数（Session 主区 2，Today 子区 4）
 * @param firstColHeader - 首列表头文案（默认 'Name'，By Day 用 'Date'）
 */
function renderStatsTable(rows: StatsTableRow[], indent = 2, firstColHeader = 'Name'): void {
  if (rows.length === 0) return;
  const pad = ' '.repeat(indent);
  // 列定义：header 字段顺序对应 row 字段
  const headers = [firstColHeader, 'Requests', 'Input', 'Output', 'Cached', 'Errors'];
  const keys: (keyof StatsTableRow)[] = ['name', 'requests', 'input', 'output', 'cached', 'errors'];
  // 每列最大宽度：max(表头, 各行对应字段)，name 左对齐其余右对齐
  const widths = keys.map((key, i) =>
    Math.max(
      headers[i].length,
      ...rows.map(r => String(r[key]).length),
    ),
  );
  const headerLine = keys.map((_, i) => {
    const h = headers[i];
    return i === 0 ? h.padEnd(widths[i]) : h.padStart(widths[i]);
  }).join('  ');
  const sep = '─'.repeat(headerLine.length);
  console.log(`${pad}${headerLine}`);
  console.log(`${pad}${sep}`);
  for (const r of rows) {
    const line = keys.map((key, i) => {
      const v = String(r[key]);
      return i === 0 ? v.padEnd(widths[i]) : v.padStart(widths[i]);
    }).join('  ');
    console.log(`${pad}${line}`);
  }
}

/** 将单个统计项转换为表格行；errors=0 时显示 '-'，cached=0 时显示 '+' */
function toStatsTableRow(name: string, s: {
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens?: number;
  errors?: number;
}): StatsTableRow {
  return {
    name,
    requests: String(s.requestCount),
    input: fmtTokens(s.totalPromptTokens),
    output: fmtTokens(s.totalCompletionTokens),
    cached: `+${fmtTokens(s.totalCachedTokens ?? 0)}`,
    errors: (s.errors ?? 0) > 0 ? String(s.errors) : '-',
  };
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
  console.log(`  Errors:         ${stats.errors} (${errorRate(stats.errors, stats.requestCount)}%)`);
  const protocolKeys = Object.keys(stats.protocols);
  if (protocolKeys.length > 0) {
    console.log('────────────────────────────────────────────────');
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
  console.log(`  Errors:         ${sessionStats.errors} (${errorRate(sessionStats.errors, sessionStats.requestCount)}%)`);
  console.log(`  Uptime:         ${fmtUptime(uptime)}`);

  // By Day 分日明细：始终展示（单日时一行），合并原 Today 区，避免与 dailyStats 持久化累计语义混淆
  const byDateKeys = Object.keys(sessionStats.byDate).sort();
  if (byDateKeys.length > 0) {
    console.log('────────────────────────────────────────────────');
    console.log('  By Day:');
    renderStatsTable(byDateKeys.map(date => toStatsTableRow(date, sessionStats.byDate[date])), 2, 'Date');
  }

  const sessionProtocolKeys = Object.keys(sessionStats.protocols);
  if (sessionProtocolKeys.length > 0) {
    console.log('────────────────────────────────────────────────');
    console.log('  By Protocol:');
    const sorted = sessionProtocolKeys.sort((a, b) => sessionStats.protocols[b].requestCount - sessionStats.protocols[a].requestCount);
    renderStatsTable(sorted.map(name => toStatsTableRow(name, sessionStats.protocols[name])));
  }

  const sessionModelKeys = Object.keys(sessionStats.models);
  if (sessionModelKeys.length > 0) {
    console.log('────────────────────────────────────────────────');
    console.log('  By Model:');
    const sorted = sessionModelKeys.sort((a, b) => sessionStats.models[b].requestCount - sessionStats.models[a].requestCount);
    renderStatsTable(sorted.map(name => toStatsTableRow(name, sessionStats.models[name])));
  }

  console.log('════════════════════════════════════════════════');
  console.log('');
}
