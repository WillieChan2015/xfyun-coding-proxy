import { useState, useEffect, useCallback } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Header } from './header';
import { TokenPanel } from './token-panel';
import { RequestPanel } from './request-panel';
import { LogStream, LogEntry } from './log-stream';
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

/** 从 RequestLogEntry 转换为 LogEntry */
function toLogEntries(): LogEntry[] {
  const log = getRequestLog();
  return log.map(entry => ({
    time: new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    method: entry.method,
    path: entry.path,
    protocol: entry.protocol,
    model: entry.model,
    latencyMs: entry.latencyMs,
    tokens: entry.inputTokens + entry.outputTokens,
    success: entry.success,
  }));
}

interface AppProps {
  version: string;
  onQuit: () => void;
}

export function MonitorApp({ version, onQuit }: AppProps) {
  const { exit } = useApp();

  const [state, setState] = useState<MonitorState>({
    requestsPerMin: 0,
    successRate: 100,
    tokenInput: 0,
    tokenOutput: 0,
    byProtocol: [],
    active: 0,
    streaming: 0,
    totalToday: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    logEntries: [],
  });

  const [scrollOffset, setScrollOffset] = useState(0);

  // 刷新全部状态
  const refreshState = useCallback(() => {
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
      avgLatencyMs: latency.avg,
      p95LatencyMs: latency.p95,
      logEntries: toLogEntries(),
    }));
  }, []);

  // 订阅 stats 事件
  useEffect(() => {
    const onComplete = (_event: RequestCompleteEvent) => {
      requestTimestamps.push(Date.now());
      refreshState();
    };

    statsEmitter.on('request:complete', onComplete);
    return () => {
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
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    if (input === 'q') {
      onQuit();
      exit();
    }
    if (key.upArrow) {
      setScrollOffset(prev => Math.min(prev + 1, state.logEntries.length - 8));
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.max(prev - 1, 0));
    }
    if (input === 'r') {
      resetDailyStats();
      refreshState();
    }
  });

  return (
    <Box flexDirection="column">
      <Header version={version} requestsPerMin={state.requestsPerMin} successRate={state.successRate} />
      <Box flexDirection="row">
        <Box width="50%">
          <TokenPanel input={state.tokenInput} output={state.tokenOutput} byProtocol={state.byProtocol} />
        </Box>
        <Box width="50%">
          <RequestPanel
            active={state.active}
            streaming={state.streaming}
            totalToday={state.totalToday}
            avgLatencyMs={state.avgLatencyMs}
            p95LatencyMs={state.p95LatencyMs}
          />
        </Box>
      </Box>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        <LogStream entries={state.logEntries} scrollOffset={scrollOffset} />
      </Box>
      <Footer />
    </Box>
  );
}
