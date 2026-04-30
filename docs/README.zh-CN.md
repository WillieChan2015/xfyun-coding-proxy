# xfyun-coding-proxy

[English](../README.md)

本地代理服务，将 OpenAI 协议格式的请求转发到讯飞星辰 Coding Plan API，供 OpenCode / Cursor / Trae 等编程工具使用。

> **当前版本：** `0.0.1-alpha`
>
> 当前项目处于 alpha 预览阶段，接口、配置和行为在首个稳定版本前仍可能发生调整。
>
> 版本变更记录见 [`../CHANGELOG.md`](../CHANGELOG.md)。

## 工作原理

```
OpenCode / Cursor / Trae / 其他工具
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
- **自动重试** — HTTP 429/503 及讯飞业务错误码 10012、10010、10006，指数退避重试
- **日志** — 控制台单行可读输出 + 本地文件按天轮转（保留 7 天）
- **会话摘要** — 退出时输出请求数、token 消耗、重试次数、错误数和运行时长

## 运行时要求

可根据使用方式选择对应运行时：

| 场景 | 所需运行时 | 说明 |
|---|---|---|
| 从当前源码仓库开发 / 调试 | **Bun** + **Node.js 20+** | `pnpm start` 和 `pnpm dev` 会直接调用 Bun；Node.js 20+ 是 `pnpm build`、打包校验以及 `dist/` 编译产物的受支持目标运行时。 |
| 运行编译产物或已发布包 | **Node.js 20+** | 可分发入口是 `dist/index.js`，因此脱离源码开发后不再依赖 Bun。 |

## 快速开始

下面的步骤默认你是在源码仓库中开发，并且已经安装好 Bun。

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

默认监听地址为 `127.0.0.1:3000`，对外提供的 OpenAI 兼容 Base URL 为 `http://127.0.0.1:3000/v1`。

## 开发

源码开发依赖 Bun，因为本地启动和 watch 脚本都会直接调用 Bun。与此同时，建议保留 Node.js 20+ 作为 `pnpm build`、发布校验以及运行 `dist/` 编译产物时的目标运行时。

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

### CLI 参数

也可以通过命令行参数配置代理：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-p, --port <port>` | 代理服务监听端口 | `3000` |
| `-k, --api-key <key>` | 讯飞 Coding Plan API Key | 无 |
| `--base-url <url>` | 讯飞 API Base URL | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` |
| `--max-retries <n>` | 最大重试次数 | `3` |
| `--retry-delay <ms>` | 初始重试延迟（毫秒） | `1000` |
| `-v, --verbose` | 启用调试日志 | `false` |

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

### Trae

在 Trae 中添加自定义 OpenAI 兼容 provider 时：

- 自定义 URL 设为 `http://localhost:3000/v1/chat/completions`；
- API Key 可填写任意占位值，例如 `local-proxy`；
- 如果 Trae 要求填写模型名，可保留任意占位值，代理在转发前会统一覆盖为 `astron-code-latest`。

这个代理还额外处理了与 Trae 相关的兼容问题：

- 过滤 `progress_notice`、`context_usage` 等非标准 SSE 事件，避免流式解析报错；
- 丢弃可能被讯飞上游拒绝的非标准请求头。

## 兼容性说明

- 代理默认仅监听 `127.0.0.1`，面向本地使用场景。
- 源码仓库的本地开发脚本依赖 Bun，而编译后的 `dist/` 产物与发布包面向 Node.js `>=20`。
- 客户端传入的模型名会在转发前统一覆盖为 `astron-code-latest`。
- 类似 `"true"` 的字符串型 `stream` 参数会被规范化为布尔值 `true`。
- 错误响应会尽量保持 OpenAI 风格的 `{ error: { message, type, code } }` 结构。

## 项目结构

```
src/
├── index.ts    # 入口、Fastify 服务器、优雅关停
├── proxy.ts    # 代理核心：转发 + 流式 + 重试 + SSE 过滤
├── cli.ts      # CLI 参数解析（commander）
├── config.ts   # 配置：CLI 参数 + 环境变量 + 校验
├── stats.ts    # 会话统计追踪 + 退出摘要
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
