import path from 'node:path';
import Fastify, { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ResolvedConfig, config, DEFAULT_MODEL, SUPPORTED_MODELS, resolveModelId } from './config';
import { handleProxy, handleGetProxy } from './proxy';
import { handleOllamaChat, handleOllamaGenerate } from './ollama/handler';
import { handleAnthropicMessages } from './anthropic/handler';
import { convertTagsResponse, buildShowResponse } from './ollama/response';
import { estimateInputTokens } from './util';
import { printSessionSummary, initDailyStats, saveDailyStats, saveDailyStatsAsync, rolloverDailyStats, dailyStats, recordRequestComplete, requestFinished, getRequestLog, statsEmitter, sessionStats, getActiveRequests, getStreamingRequests, getLatencyStats, resetDailyStats, setRolloverFn, setSaveFn, isDailyStatsDirty, setDailyStatsDirty, Protocol } from './stats';
import { checkForUpdate } from './update-check';
import { getPackageVersion, getPackageName } from './cli';

const name = getPackageName();
const version = getPackageVersion();
let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 生成 OpenAI /v1/models 格式的模型列表
 * 讯飞上游 /v2/models 返回空数组，本地生成供 IDE 发现可用模型
 */
function buildModelsList() {
  return {
    object: 'list' as const,
    data: [
      { id: DEFAULT_MODEL, object: 'model' as const, created: 1_700_000_000, owned_by: 'xfyun', name: DEFAULT_MODEL },
      ...SUPPORTED_MODELS.map(m => ({
        id: m.id,
        object: 'model' as const,
        created: 1_700_000_000,
        owned_by: 'xfyun',
        name: m.name,
        context_length: m.contextLength,
      })),
    ],
  };
}

// 设置/恢复终端标题：OSC 转义序列，仅对真实 TTY 有效
function setTerminalTitle(title: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }
}

/**
 * 记录静态路由请求的 pino 日志 + 面板日志
 * 静态路由不走 upstreamRequest，不计入请求统计（countable: false），但需在面板 LogStream 中显示
 */
function logStaticRequest(
  request: FastifyRequest,
  protocol: Protocol,
  label: string,
  method: string = request.method,
): void {
  const start = Date.now();
  request.log.info(`${label} | ${request.url}`);
  // 利用 JS 微任务：在 handler return 之后（响应已发送）再计算延迟
  // 避免在同步 handler 中 latencyMs ≈ 0 无参考价值
  queueMicrotask(() => {
    recordRequestComplete({
      protocol, model: DEFAULT_MODEL, inputTokens: 0, outputTokens: 0, cachedTokens: 0,
      latencyMs: Date.now() - start, success: true, retries: 0,
      method, path: request.url, ua: request.headers['user-agent'] ?? 'unknown',
      countable: false,
    });
  });
}

/**
 * 注册 Ollama 静态路由（/api/tags、/api/version、/api/show）
 * prefix 为 '/ollama' 或 ''，避免重复定义相同的 handler
 */
function registerOllamaStaticRoutes(server: FastifyInstance, prefix: string): void {
  server.get(`${prefix}/api/tags`, async (request: FastifyRequest) => {
    // 本地生成：讯飞上游 /v2/models 返回空数组，透传无意义
    logStaticRequest(request, 'ollama', 'ollama tags');
    return convertTagsResponse();
  });
  server.get(`${prefix}/api/version`, async (request: FastifyRequest) => {
    logStaticRequest(request, 'ollama', 'ollama version');
    return { version: '0.12.6' };
  });
  server.post(`${prefix}/api/show`, async (request: FastifyRequest) => {
    const body = request.body as Record<string, unknown> | undefined;
    const modelId = resolveModelId(body?.model as string | undefined, request.log);
    logStaticRequest(request, 'ollama', 'ollama show');
    return buildShowResponse(modelId);
  });
}

/**
 * 创建并配置 Fastify 实例（不调用 listen）
 * 便于测试和被其它工具内嵌调用
 */
export async function createServer(cfg: ResolvedConfig): Promise<FastifyInstance> {
  // 初始化当天统计（从持久化文件加载已有数据）
  initDailyStats(cfg.logDir);

  // 注入日期翻转回调，使 recordRequestComplete 在跨天完成时能自动触发 rollover
  setRolloverFn(() => rolloverDailyStats(cfg.logDir), true);
  // 注入保存回调，使 resetDailyStats 在重置前能先持久化当前数据
  setSaveFn((stats) => saveDailyStats(cfg.logDir, stats, dailyStats, isDailyStatsDirty, setDailyStatsDirty), true);

  // 启动定时刷盘（异步版本，避免阻塞事件循环）
  if (cfg.statsFlushInterval > 0) {
    flushTimer = setInterval(() => {
      rolloverDailyStats(cfg.logDir);
      saveDailyStatsAsync(cfg.logDir, dailyStats, dailyStats, isDailyStatsDirty).catch((err) => {
        console.warn('Periodic stats flush failed:', err);
      });
    }, cfg.statsFlushInterval);
    // 不阻止进程退出
    if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
      flushTimer.unref();
    }
  }

  // Ink 模式下移除 console transport，避免 pino 输出破坏 Ink 渲染
  const loggerTargets = cfg.monitor
    ? [
        {
          target: './pretty-roll-transport.cjs',
          level: 'info' as const,
          options: {
            file: path.join(cfg.logDir, 'proxy.log'),
            frequency: 'daily',
            dateFormat: 'yyyy-MM-dd',
            mkdir: true,
            size: '50m',
            limit: { count: 7 },
          },
        },
      ]
    : [
        {
          target: '@fastify/one-line-logger',
          level: 'info' as const,
        },
        {
          target: './pretty-roll-transport.cjs',
          level: 'info' as const,
          options: {
            file: path.join(cfg.logDir, 'proxy.log'),
            frequency: 'daily',
            dateFormat: 'yyyy-MM-dd',
            mkdir: true,
            size: '50m',
            limit: { count: 7 },
          },
        },
      ];

  const server = Fastify({
    // 超时与 body 限制：防止连接挂死/超大请求拖垮本地代理
    // requestTimeout 需大于 upstreamFetchTimeout（默认 300s），否则 Fastify 会先于 fetch 中断请求
    connectionTimeout: 30_000,
    requestTimeout: 600_000,
    bodyLimit: 10_485_760, // 10MB：编程 IDE 长上下文请求（含完整对话历史、多文件 attachment、工具定义）常达数 MB，1MB 会误拒
    logger: {
      level: cfg.verbose ? 'debug' : 'info',
      // 防止 authorization 被记录到日志（敏感凭据保护）
      redact: ['req.headers.authorization'],
      transport: {
        targets: loggerTargets,
      },
    },
  });

  await server.register(cors, { origin: true });

  // 记录所有进入的请求（包括 body 解析失败的请求），便于排查客户端报错但日志无记录的问题
  server.addHook('onRequest', async (request) => {
    request.log.debug(`onRequest | ${request.method} ${request.url} | content-type=${request.headers['content-type'] ?? 'n/a'}`);
  });

  // OpenAI 格式错误响应：客户端（OpenCode/Cursor 等）期望 { error: { message, type, code } } 结构
  server.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode || 500;
    const ua = request.headers['user-agent'] ?? 'unknown';
    request.log.error(`request error | ${status} | ${error.message} | ua=${ua} | url=${request.url}`);

    // 兜底：handler 中 recordRequestStart 之后若抛出未捕获异常，
    // recordRequestComplete 不会被调用，pending 日志条目会卡在 processing。
    // 在此处补调，确保日志状态正确更新。
    // 通过查找 pending 条目判断是否需要补调：若该 requestId 仍有 pending 条目，
    // 说明 handler 未调用 recordRequestComplete，需要此处兜底。
    const hasPending = getRequestLog().some(
      e => e.requestId === request.id && e.pending,
    );
    if (hasPending) {
      const protocol = request.url.startsWith('/ollama/') ? 'ollama'
        : request.url.startsWith('/anthropic/') ? 'anthropic'
        : 'openai';
      // body 解析失败时无法获知真实 model，用 unknown 而非 DEFAULT_MODEL，避免统计误导
      recordRequestComplete({
        protocol,
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        latencyMs: 0,
        success: false,
        requestId: request.id,
        path: request.url,
        ua,
        retries: 0,
        error: error.message,
      });
      requestFinished();
    } else {
      // handler 未调用 recordRequestStart（如 Fastify body 解析失败），
      // 仍需记录错误到统计系统，避免客户端报错但统计无记录
      const protocol = request.url.startsWith('/ollama/') ? 'ollama'
        : request.url.startsWith('/anthropic/') ? 'anthropic'
        : 'openai';
      recordRequestComplete({
        protocol,
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        latencyMs: 0,
        success: false,
        requestId: request.id,
        path: request.url,
        ua,
        retries: 0,
        error: error.message,
      });
    }

    // 流式请求中 reply.raw.writeHead(200) 已发送，此时若 handler 抛出异常，
    // Fastify 仍会进入 setErrorHandler，但 reply.status().send() 会因 headers 已发送
    // 而抛出 ERR_HTTP_HEADERS_SENT。检测 headersSent 后写入 SSE 错误事件再结束流，
    // 让客户端收到错误信息而非空 body。
    if (reply.raw.headersSent) {
      const isAnthropic = request.url.startsWith('/anthropic/');
      // Anthropic SSE 错误事件格式与 OpenAI 不同
      const sseError = isAnthropic
        ? `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message || 'Internal server error' } })}\n\n`
        : `data: ${JSON.stringify({ error: { message: error.message || 'Internal server error', type: 'upstream_error', code: status } })}\n\ndata: [DONE]\n\n`;
      try { reply.raw.write(sseError); } catch { /* client already closed */ }
      try { reply.raw.end(); } catch { /* client already closed */ }
      return;
    }

    reply.status(status).send({
      error: {
        message: error.message || 'Internal server error',
        type: error.name || 'internal_error',
        code: status,
      },
    });
  });

  // 本地生成模型列表：讯飞上游 /v2/models 返回空数组，透传无意义，改为本地生成
  server.get('/v1/models', async (request: FastifyRequest) => {
    logStaticRequest(request, 'openai', 'openai models');
    return buildModelsList();
  });
  server.post('/v1/*', handleProxy);
  server.get('/v1/*', handleGetProxy);

  // Anthropic 协议路由：带 /anthropic 前缀（Base URL = http://localhost:3000/anthropic）
  // HEAD /anthropic：客户端启动时的连通性探测
  server.head('/anthropic', async (request: FastifyRequest, reply: FastifyReply) => {
    logStaticRequest(request, 'anthropic', 'anthropic ping', 'HEAD');
    reply.status(200).send();
  });
  server.post('/anthropic/v1/messages', handleAnthropicMessages);
  // count_tokens：上游不支持，本地按 1 token ≈ 4 字符估算
  server.post('/anthropic/v1/messages/count_tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (!body) {
      reply.status(400).send({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'request body is required' },
      });
      return;
    }
    const inputTokens = estimateInputTokens(body);
    request.log.info(`anthropic count_tokens | estimated=${inputTokens}`);
    reply.send({ input_tokens: inputTokens });
  });
  server.get('/anthropic/v1/models', async (request: FastifyRequest) => {
    logStaticRequest(request, 'anthropic', 'anthropic models');
    return buildModelsList();
  });

  // Ollama 协议路由：带 /ollama 前缀（Base URL = http://localhost:3000/ollama）
  server.post('/ollama/api/chat', handleOllamaChat);
  server.post('/ollama/api/generate', handleOllamaGenerate);
  // VS Code Continue.dev 等工具在 Ollama 模式下使用 OpenAI 兼容路径
  server.post('/ollama/v1/chat/completions', handleProxy);
  server.get('/ollama/v1/models', async (request: FastifyRequest) => {
    logStaticRequest(request, 'ollama', 'ollama models');
    return buildModelsList();
  });
  registerOllamaStaticRoutes(server, '/ollama');

  // Ollama 协议路由：不带前缀（Base URL = http://localhost:3000，VSCode 等工具直接拼接 /api/tags）
  server.post('/api/chat', handleOllamaChat);
  server.post('/api/generate', handleOllamaGenerate);
  registerOllamaStaticRoutes(server, '');

  server.get('/health', async (request: FastifyRequest) => {
    logStaticRequest(request, 'openai', 'health check');
    return { status: 'ok', upstream: config.baseUrl };
  });

  server.setNotFoundHandler((request, reply) => {
    // 仅记录 method+url，避免泄露 headers（含 authorization）和 body
    request.log.warn(`unmatched route | ${request.method} ${request.url}`);
    reply.status(404).send({
      error: 'not found',
      method: request.method,
      url: request.url,
      hint: 'Supported routes: POST /v1/chat/completions, POST /anthropic/v1/messages, POST /anthropic/v1/messages/count_tokens, POST /ollama/api/chat, POST /ollama/api/generate, GET /ollama/api/tags',
    });
  });

  return server;
}

/**
 * 启动服务器监听 + 注册 SIGINT/SIGTERM 优雅关停
 * 若 cfg.monitor 为 true，启动 Ink 监控面板
 */
export async function startServer(server: FastifyInstance, cfg: ResolvedConfig): Promise<void> {
  try {
    await server.listen({ port: cfg.port, host: '127.0.0.1' });
  } catch (err) {
    // 使用 console.error 同步输出，确保端口占用等启动失败错误一定在控制台可见。
    // server.log.error 依赖 pino 异步 transport（monitor 模式下无 console transport），
    // 且 process.exit(1) 可能在异步日志 flush 前终止进程，导致静默崩溃。
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`Error: Port ${cfg.port} is already in use. Please free the port or specify a different one with --port.`);
    } else {
      console.error('Failed to start server:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
  // monitor 模式下 pino 无 console transport，server.log.info 不会输出到终端，
  // 改用 console.log 确保启动信息在 Ink 接管 stdout 前可见
  const logStartup = cfg.monitor
    ? (msg: string) => console.log(msg)
    : (msg: string) => server.log.info(msg);
  // logStartup(`${name} v${version}`);
  logStartup(`Forwarding /v1/* → ${cfg.baseUrl} (OpenAI protocol)`);
  logStartup(`Forwarding /ollama/* → ${cfg.baseUrl} (Ollama protocol)`);
  logStartup(`Forwarding /anthropic/* → ${cfg.anthropicBaseUrl} (Anthropic protocol)`);
  logStartup(`Config file: ${cfg.configFile ?? '(none)'}`);
  logStartup(`Log dir: ${cfg.logDir}`);
  if (cfg.debug) logStartup(`Debug mode: ON (logging request/response data to ${cfg.logDir}/debug/)`);
  logStartup(`Listening on http://127.0.0.1:${cfg.port}`);
  setTerminalTitle(`${name} :${cfg.port}`);
  // 异步检查 npm registry 是否有新版本，不阻塞启动
  checkForUpdate(cfg.logDir, version).catch(() => {});

  // Ink 监控面板：接管 stdout，按 q 退出时触发优雅关停
  // 优雅关停逻辑：保存 stats → 关闭 server → 退出进程
  let shutdownStarted = false;
  const gracefulShutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    rolloverDailyStats(cfg.logDir);
    // rolloverDailyStats 跨天时会将 dailyStatsDirty 重置为 false，
    // 此时 saveDailyStats 因 !dirty 跳过保存是正确的——新一天尚无请求数据无需持久化。
    // 若在 rollover 和 save 之间新增修改 dailyStats 的逻辑，需同步置 dirty = true。
    saveDailyStats(cfg.logDir, dailyStats, dailyStats, isDailyStatsDirty, setDailyStatsDirty);
    if (monitorHandle) {
      monitorHandle.unmount();
    }
    await server.close();
    server.log.info('Server closed');
    setTerminalTitle('');
    printSessionSummary();
    process.exit(0);
  };

  let monitorHandle: { unmount: () => void } | null = null;
  if (cfg.monitor) {
    const { startMonitor } = await import('./monitor/entry.js');
    // 将主进程的 stats 依赖注入 monitor 面板，确保面板操作的是同一份状态
    // （bun 打包会内联 stats.ts，导致 Node.js 运行时 monitor 持有独立副本，面板数据为空）
    monitorHandle = await startMonitor(name, version, () => {
      gracefulShutdown().catch(() => process.exit(1));
    }, {
      statsEmitter, sessionStats, dailyStats,
      getActiveRequests, getStreamingRequests, getLatencyStats,
      getRequestLog, resetDailyStats,
    }, {
      port: cfg.port,
      baseUrl: cfg.baseUrl,
      anthropicBaseUrl: cfg.anthropicBaseUrl,
    });
  }

  // 优雅关停：收到 SIGINT/SIGTERM 后等待进行中的请求结束再退出
  // 首次信号执行优雅关停，再次收到信号则强制退出
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      if (shuttingDown) {
        server.log.info(`Received ${signal} again, forcing exit`);
        process.exit(1);
      }
      shuttingDown = true;
      server.log.info(`Received ${signal}, shutting down gracefully`);
      try {
        await gracefulShutdown();
      } catch (err) {
        server.log.error(err, 'Error during shutdown');
        process.exit(1);
      }
    });
  }
}
