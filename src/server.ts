import path from 'node:path';
import Fastify, { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ResolvedConfig, config, DEFAULT_MODEL } from './config';
import { handleProxy, handleGetProxy } from './proxy';
import { handleOllamaChat, handleOllamaGenerate } from './ollama/handler';
import { handleAnthropicMessages } from './anthropic/handler';
import { estimateInputTokens } from './util';
import { printSessionSummary, initDailyStats, saveDailyStats, rolloverDailyStats, dailyStats, recordRequestComplete, requestFinished, getRequestLog, statsEmitter, sessionStats, getActiveRequests, getStreamingRequests, getLatencyStats, resetDailyStats } from './stats';
import { checkForUpdate } from './update-check.js';

// 读取当前包版本，用于启动时更新检查
const { name, version } = require('../package.json');
let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 创建并配置 Fastify 实例（不调用 listen）
 * 便于测试和被其它工具内嵌调用
 */
export async function createServer(cfg: ResolvedConfig): Promise<FastifyInstance> {
  // 初始化当天统计（从持久化文件加载已有数据）
  initDailyStats(cfg.logDir);

  // 启动定时刷盘
  if (cfg.statsFlushInterval > 0) {
    flushTimer = setInterval(() => {
      rolloverDailyStats(cfg.logDir);
      saveDailyStats(cfg.logDir, dailyStats);
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
          target: './pretty-roll-transport.js',
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
          target: './pretty-roll-transport.js',
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
    // requestTimeout 需大于 fetch 上游超时(120s)，否则 Fastify 会先于 fetch 中断请求
    connectionTimeout: 30_000,
    requestTimeout: 180_000,
    bodyLimit: 1_048_576, // 1MB
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
      recordRequestComplete({
        protocol,
        model: DEFAULT_MODEL,
        inputTokens: 0,
        outputTokens: 0,
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
        model: DEFAULT_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        success: false,
        requestId: request.id,
        path: request.url,
        ua,
        retries: 0,
        error: error.message,
      });
    }

    reply.status(status).send({
      error: {
        message: error.message || 'Internal server error',
        type: error.name || 'internal_error',
        code: status,
      },
    });
  });

  server.post('/v1/*', handleProxy);
  server.get('/v1/*', handleGetProxy);

  // Anthropic 协议路由：带 /anthropic 前缀（Base URL = http://localhost:3000/anthropic）
  // HEAD /anthropic：客户端启动时的连通性探测
  server.head('/anthropic', async (_request, reply) => { reply.status(200).send(); });
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
  server.get('/anthropic/v1/models', async () => {
    return {
      object: 'list',
      data: [{
        id: DEFAULT_MODEL,
        object: 'model',
        created: 1_700_000_000,
        owned_by: 'xfyun',
      }],
    };
  });

  // Ollama 协议路由：带 /ollama 前缀（Base URL = http://localhost:3000/ollama）
  server.post('/ollama/api/chat', handleOllamaChat);
  server.post('/ollama/api/generate', handleOllamaGenerate);
  // VS Code Continue.dev 等工具在 Ollama 模式下使用 OpenAI 兼容路径
  server.post('/ollama/v1/chat/completions', handleProxy);
  server.get('/ollama/v1/models', handleGetProxy);
  server.get('/ollama/api/tags', async () => {
    return {
      models: [{
        name: DEFAULT_MODEL,
        model: DEFAULT_MODEL,
        modified_at: new Date().toISOString(),
        size: 0,
        digest: '',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'astron',
          parameter_size: '',
          quantization_level: '',
        },
      }],
    };
  });
  server.get('/ollama/api/version', async () => {
    return { version: '0.12.6' };
  });
  server.post('/ollama/api/show', async () => {
    return {
      modified_at: new Date().toISOString(),
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'astron',
        families: ['astron'],
        parameter_size: '',
        quantization_level: '',
      },
      capabilities: ['completion', 'tools'],
      model_info: {
        'general.architecture': 'astron',
        'astron.context_length': 192000,
        'general.parameter_count': 0,
      },
    };
  });

  // Ollama 协议路由：不带前缀（Base URL = http://localhost:3000，VSCode 等工具直接拼接 /api/tags）
  server.post('/api/chat', handleOllamaChat);
  server.post('/api/generate', handleOllamaGenerate);
  server.get('/api/tags', async () => {
    return {
      models: [{
        name: DEFAULT_MODEL,
        model: DEFAULT_MODEL,
        modified_at: new Date().toISOString(),
        size: 0,
        digest: '',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'astron',
          parameter_size: '',
          quantization_level: '',
        },
      }],
    };
  });
  server.get('/api/version', async () => {
    return { version: '0.12.6' };
  });
  server.post('/api/show', async () => {
    return {
      modified_at: new Date().toISOString(),
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'astron',
        families: ['astron'],
        parameter_size: '',
        quantization_level: '',
      },
      capabilities: ['completion', 'tools'],
      model_info: {
        'general.architecture': 'astron',
        'astron.context_length': 192000,
        'general.parameter_count': 0,
      },
    };
  });

  server.get('/health', async () => {
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
  server.log.info(`${name} v${version}`);
  server.log.info(`Forwarding /v1/* → ${cfg.baseUrl} (OpenAI protocol)`);
  server.log.info(`Forwarding /ollama/* → ${cfg.baseUrl} (Ollama protocol)`);
  server.log.info(`Forwarding /anthropic/* → ${cfg.anthropicBaseUrl} (Anthropic protocol)`);
  server.log.info(`Config file: ${cfg.configFile ?? '(none)'}`);
  server.log.info(`Log dir: ${cfg.logDir}`);
  // 异步检查 npm registry 是否有新版本，不阻塞启动
  checkForUpdate(cfg.logDir, version).catch(() => {});

  // Ink 监控面板：接管 stdout，按 q 退出时触发优雅关停
  // 优雅关停逻辑：保存 stats → 关闭 server → 退出进程
  const gracefulShutdown = async () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    saveDailyStats(cfg.logDir, dailyStats);
    if (monitorHandle) {
      monitorHandle.unmount();
    }
    await server.close();
    server.log.info('Server closed');
    printSessionSummary();
    process.exit(0);
  };

  let monitorHandle: { unmount: () => void } | null = null;
  if (cfg.monitor) {
    // Node 发布态加载 bun 产出的 monitor ESM bundle；Bun 源码运行时则直接加载 TS 入口。
    // 使用 Function('return import') 确保 tsc (module: commonjs) 不会将 import() 编译为 require()。
    const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (path: string) => Promise<any>;
    const monitorModulePath = process.versions.bun ? './monitor/entry.ts' : './monitor.mjs';
    const { startMonitor } = await dynamicImport(monitorModulePath);
    // 将主进程的 stats 依赖注入 monitor 面板，确保面板操作的是同一份状态
    // （bun 打包会内联 stats.ts，导致 Node.js 运行时 monitor 持有独立副本，面板数据为空）
    monitorHandle = await startMonitor(name, version, () => {
      gracefulShutdown().catch(() => process.exit(1));
    }, {
      statsEmitter, sessionStats, dailyStats,
      getActiveRequests, getStreamingRequests, getLatencyStats,
      getRequestLog, resetDailyStats,
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
