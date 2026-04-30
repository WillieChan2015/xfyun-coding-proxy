# xfyun-coding-proxy

[English](../README.md)

本地代理服务，将 OpenAI 协议格式的请求转发到讯飞星辰 Coding Plan API，供 OpenCode / Cursor 等编程工具使用。

## 工作原理

```
OpenCode / Cursor / 其他工具
        ↓  http://localhost:3000/v1/chat/completions
   ┌─────────────────────────┐
   │   Fastify 代理服务       │
   │                         │
   │  1. API Key 注入        │
   │  2. 请求日志            │
   │  3. 转发到讯飞           │
   │  4. SSE 流式透传        │
   │  5. 429/503 自动重试    │
   └─────────────────────────┘
        ↓  https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions
   讯飞星辰 Coding Plan API
```

## 功能

- **API Key 注入** — 客户端无需持有真实 Key，代理在转发时自动替换 `Authorization` header
- **路径重写** — `/v1/` → 讯飞 `/v2/` 前缀
- **SSE 流式透传** — 实时转发流式响应，过滤讯飞非标准 SSE 事件（`progress_notice`、`context_usage`）
- **字段清理** — 自动移除 `reasoning_content`、`plugins_content` 等讯飞特有字段
- **自动重试** — HTTP 429/503 及讯飞业务错误码 10012，指数退避重试
- **日志** — 控制台单行可读输出 + 本地文件按天轮转（保留 7 天）

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 XFYUN_API_KEY

# 启动
pnpm start

# 开发模式（热重载）
pnpm dev
```

## 开发

```bash
pnpm dev          # 热重载启动
pnpm test         # 运行测试
pnpm test:watch   # 测试 watch 模式
pnpm lint         # 代码检查
pnpm format       # 代码格式化
pnpm build        # 编译 TypeScript 到 dist/
```

## 配置

通过 `.env` 文件或环境变量配置：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 代理服务监听端口 |
| `XFYUN_API_KEY` | 必填 | 讯飞 Coding Plan API Key |
| `XFYUN_BASE_URL` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` | 讯飞 API Base URL |
| `MAX_RETRIES` | `3` | 最大重试次数 |
| `RETRY_DELAY_MS` | `1000` | 初始重试延迟（ms） |

## 客户端配置

### OpenCode

```json
{
  "provider": {
    "AstronCodingPlan": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "讯飞星辰 Coding Plan",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "local-proxy"
      }
    }
  }
}
```

### Cursor

Override OpenAI Base URL 设为 `http://localhost:3000/v1`。

## 项目结构

```
src/
├── index.ts    # 入口、Fastify 服务器、优雅关停
├── proxy.ts    # 代理核心：转发 + 流式 + 重试 + SSE 过滤
├── cli.ts      # CLI 参数解析（commander）
├── config.ts   # 配置：CLI 参数 + 环境变量 + 校验
└── util.ts     # token 用量提取 + 格式化
```

## 日志

- **控制台**：通过 `@fastify/one-line-logger` 输出单行可读格式
- **文件**：通过 `pino-roll` 写入 `./logs/proxy.log`，按天轮转，单文件超 50MB 也会轮转，保留最近 7 个文件

## 健康检查

```
GET /health
```

返回：

```json
{ "status": "ok", "upstream": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2" }
```

## License

MIT
