#!/usr/bin/env node
import Fastify, { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { config, validateConfig } from './config';
import { handleProxy } from './proxy';
import { printSessionSummary } from './stats';

async function main() {
  validateConfig();

  const server = Fastify({
    // 超时与 body 限制：防止连接挂死/超大请求拖垮本地代理
    connectionTimeout: 30_000,
    requestTimeout: 60_000,
    bodyLimit: 1_048_576, // 1MB
    logger: {
      level: config.verbose ? 'debug' : 'info',
      // 防止 authorization 被记录到日志（敏感凭据保护）
      redact: ['req.headers.authorization'],
      transport: {
        targets: [
          {
            target: '@fastify/one-line-logger',
            level: 'info',
          },
          {
            target: 'pino-roll',
            level: 'info',
            options: {
              file: './logs/proxy.log',
              frequency: 'daily',
              mkdir: true,
              size: '50m',
              limit: { count: 7 },
            },
          },
        ],
      },
    },
  });

  await server.register(cors, { origin: true });

  // OpenAI 格式错误响应：客户端（OpenCode/Cursor 等）期望 { error: { message, type, code } } 结构
  server.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode || 500;
    request.log.error({ error: error.message, status }, 'request error');
    reply.status(status).send({
      error: {
        message: error.message || 'Internal server error',
        type: error.name || 'internal_error',
        code: status,
      },
    });
  });

  server.post('/v1/*', handleProxy);

  server.get('/health', async () => {
    return { status: 'ok', upstream: config.baseUrl };
  });

  server.setNotFoundHandler((request, reply) => {
    // 仅记录 method+url，避免泄露 headers（含 authorization）和 body
    request.log.warn({ method: request.method, url: request.url }, 'unmatched route');
    reply.status(404).send({
      error: 'not found',
      method: request.method,
      url: request.url,
      hint: 'POST /v1/chat/completions is the only supported proxy route',
    });
  });

  try {
    await server.listen({ port: config.port, host: '127.0.0.1' });
    server.log.info(`Forwarding /v1/* → ${config.baseUrl}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // 优雅关停：收到 SIGINT/SIGTERM 后等待进行中的请求结束再退出
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down gracefully`);
      try {
        await server.close();
        server.log.info('Server closed');
        printSessionSummary();
        process.exit(0);
      } catch (err) {
        server.log.error(err, 'Error during shutdown');
        process.exit(1);
      }
    });
  }
}

main();
