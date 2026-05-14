import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Header } from './header';
import { TokenPanel } from './token-panel';
import { RequestPanel } from './request-panel';
import { LogStream, LogEntry, LogTab } from './log-stream';
import { Footer } from './footer';
import {
  statsEmitter,
  RequestCompleteEvent,
  sessionStats,
  dailyStats,
  getActiveRequests,
  getStreamingRequests,
  getLatencyStats,
  getRequestLog,
  resetDailyStats,
} from '../stats';

interface MonitorState {
  requestsPerMin: number;
  successRate: number;
  tokenInput: number;
  tokenOutput: number;
  byProtocol: { name: string; tokens: number }[];
  active: number;
  streaming: number;
  totalToday: number;
  todayErrors: number;
  totalSession: number;
  sessionErrors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  logEntries: LogEntry[];
}

/** 滑动窗口 60s 内的请求时间戳，用于计算 req/min */
const requestTimestamps: number[] = [];

function getRequestsPerMin(): number {
  const now = Date.now();
  // 清理超过 60s 的时间戳
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60000) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length;
}

/** 从 sessionStats 计算成功率 */
function calcSuccessRate(): number {
  if (sessionStats.requestCount === 0) return 100;
  return ((sessionStats.requestCount - sessionStats.errors) / sessionStats.requestCount) * 100;
}

/** 从 sessionStats.protocols 构建 byProtocol 数组 */
function getProtocolUsage(): { name: string; tokens: number }[] {
  return Object.entries(sessionStats.protocols).map(([name, p]) => ({
    name,
    tokens: p.totalPromptTokens + p.totalCompletionTokens,
  }));
}

/** 格式化为本地时间 2026-05-13 10:11:03.676 */
function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 从 RequestLogEntry 转换为 LogEntry */
function toLogEntries(): LogEntry[] {
  const log = getRequestLog();
  return log.map(entry => ({
    time: formatLocalTime(entry.timestamp),
    timestamp: entry.timestamp,
    method: entry.method,
    path: entry.path,
    protocol: entry.protocol,
    model: entry.model,
    latencyMs: entry.latencyMs,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    success: entry.success,
    stream: entry.stream,
    pending: entry.pending,
    requestId: entry.requestId,
    ua: entry.ua,
    error: entry.error,
  }));
}

interface AppProps {
  name: string;
  version: string;
  onQuit: () => void;
}

export function MonitorApp({ name, version, onQuit }: AppProps) {
  const { exit } = useApp();

  const [state, setState] = useState<MonitorState>(() => ({
    requestsPerMin: getRequestsPerMin(),
    successRate: calcSuccessRate(),
    tokenInput: sessionStats.totalPromptTokens,
    tokenOutput: sessionStats.totalCompletionTokens,
    byProtocol: getProtocolUsage(),
    active: getActiveRequests(),
    streaming: getStreamingRequests(),
    totalToday: dailyStats.requestCount,
    todayErrors: dailyStats.errors,
    totalSession: sessionStats.requestCount,
    sessionErrors: sessionStats.errors,
    avgLatencyMs: getLatencyStats().avg,
    p95LatencyMs: getLatencyStats().p95,
    logEntries: toLogEntries(),
  }));

  const [scrollOffset, setScrollOffset] = useState(0);
  const [logTab, setLogTab] = useState<LogTab>('all');
  const lastScrollTime = useRef(0);

  // 当前 tab 过滤后的条目数，用于滚动边界计算
  const filteredCount = logTab === 'errors'
    ? state.logEntries.filter(e => !e.success).length
    : state.logEntries.length;

  // 若处于滚动中且 5s 无操作，自动回到底部
  const autoScrollReset = useCallback(() => {
    setScrollOffset(prev => {
      if (prev > 0 && Date.now() - lastScrollTime.current > 5000) return 0;
      return prev;
    });
  }, []);

  // 刷新全部状态
  const refreshState = useCallback(() => {
    autoScrollReset();
    const latency = getLatencyStats();
    setState(prev => ({
      ...prev,
      requestsPerMin: getRequestsPerMin(),
      successRate: calcSuccessRate(),
      tokenInput: sessionStats.totalPromptTokens,
      tokenOutput: sessionStats.totalCompletionTokens,
      byProtocol: getProtocolUsage(),
      active: getActiveRequests(),
      streaming: getStreamingRequests(),
      totalToday: dailyStats.requestCount,
      todayErrors: dailyStats.errors,
      totalSession: sessionStats.requestCount,
      sessionErrors: sessionStats.errors,
      avgLatencyMs: latency.avg,
      p95LatencyMs: latency.p95,
      logEntries: toLogEntries(),
    }));
  }, []);

  // 订阅 stats 事件
  useEffect(() => {
    const onStart = () => {
      refreshState();
    };
    const onComplete = (_event: RequestCompleteEvent) => {
      requestTimestamps.push(Date.now());
      refreshState();
    };

    statsEmitter.on('request:start', onStart);
    statsEmitter.on('request:complete', onComplete);
    return () => {
      statsEmitter.off('request:start', onStart);
      statsEmitter.off('request:complete', onComplete);
    };
  }, [refreshState]);

  // 每秒刷新请求速率（即使没有新请求，速率也会随时间衰减）
  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => ({
        ...prev,
        requestsPerMin: getRequestsPerMin(),
        active: getActiveRequests(),
        streaming: getStreamingRequests(),
        logEntries: toLogEntries(),
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    // Ctrl+C：直接触发 gracefulShutdown，无需按两次
    if (input === 'c' && key.ctrl) {
      onQuit();
      exit();
      return;
    }
    if (input === 'q') {
      onQuit();
      exit();
    }
    if (key.upArrow) {
      lastScrollTime.current = Date.now();
      setScrollOffset(prev => Math.min(prev + 1, Math.max(0, filteredCount - 8)));
    }
    if (key.downArrow) {
      lastScrollTime.current = Date.now();
      setScrollOffset(prev => Math.max(prev - 1, 0));
    }
    // 左键：向上翻一页（8行），右键：向下翻一页
    if (key.leftArrow) {
      lastScrollTime.current = Date.now();
      setScrollOffset(prev => Math.min(prev + 8, Math.max(0, filteredCount - 8)));
    }
    if (key.rightArrow) {
      lastScrollTime.current = Date.now();
      setScrollOffset(prev => Math.max(prev - 8, 0));
    }
    // e 键：切换日志 tab（全部 / 错误）
    if (input === 'e') {
      setLogTab(prev => prev === 'all' ? 'errors' : 'all');
      setScrollOffset(0);
    }
    if (input === 'r') {
      resetDailyStats();
      refreshState();
    }
  });

  return (
    <Box flexDirection="column">
      <Header name={name} version={version} requestsPerMin={state.requestsPerMin} successRate={state.successRate} />
      <Box flexDirection="row">
        <Box width="50%">
          <TokenPanel input={state.tokenInput} output={state.tokenOutput} byProtocol={state.byProtocol} />
        </Box>
        <Box width="50%">
          <RequestPanel
            active={state.active}
            streaming={state.streaming}
            totalToday={state.totalToday}
            todayErrors={state.todayErrors}
            totalSession={state.totalSession}
            sessionErrors={state.sessionErrors}
            avgLatencyMs={state.avgLatencyMs}
            p95LatencyMs={state.p95LatencyMs}
          />
        </Box>
      </Box>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        <LogStream entries={state.logEntries} errorCount={state.logEntries.filter(e => !e.success).length} scrollOffset={scrollOffset} tab={logTab} />
      </Box>
      <Footer logTab={logTab} />
    </Box>
  );
}
