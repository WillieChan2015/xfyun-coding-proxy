# maas-coding-proxy

[![npm](https://img.shields.io/npm/v/maas-coding-proxy.svg)](https://www.npmjs.com/package/maas-coding-proxy) [![npm](https://img.shields.io/npm/dm/maas-coding-proxy.svg)](https://www.npmjs.com/package/maas-coding-proxy)

[English](./docs/README.en.md)

本地代理服务，将 OpenAI / Anthropic / Ollama 协议格式的请求转发到讯飞星辰 Coding Plan API，供 Claude Code / Cursor / OpenCode / VS Code Continue.dev 等编程工具使用。

> **当前版本：** `0.0.8-beta.1`
>
> 当前项目处于 beta 预览阶段，接口、配置和行为在首个稳定版本前仍可能发生调整。
>
> 版本变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。

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

### Anthropic 协议

```
Claude Code / Cursor (Anthropic 模式)
        ↓  http://localhost:3000/anthropic/v1/messages
   ┌─────────────────────────┐
   │   Fastify 代理服务       │
   │                         │
   │  1. API Key 注入        │
   │  2. 模型透传（白名单+开关）│
   │  3. 转发到讯飞           │
   │  4. SSE 流式透传        │
   │  5. 429/503/529 自动重试│
   └─────────────────────────┘
        ↓  https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic/v1/messages
   讯飞 Anthropic 兼容端点
```

## 功能

- **API Key 注入** — 客户端无需持有真实 Key，代理在转发时自动替换 `Authorization` header
- **路径重写** — `/v1/` → 讯飞 `/v2/` 前缀
- **GET & POST 代理** — 同时支持 `POST /v1/*`（聊天补全）和 `GET /v1/*`（模型列表）转发
- **SSE 流式透传** — 实时转发流式响应，过滤讯飞非标准 SSE 事件（`progress_notice`、`context_usage`）
- **字段清理** — 自动移除 `reasoning_content`、`plugins_content` 等讯飞特有字段
- **自动重试** — HTTP 429/503 及讯飞业务错误码 10012、10010、11210，指数退避重试
- **日志持久化** — 请求日志写入本地文件按天轮转（保留 7 天），monitor 模式下日志仅写文件，`--no-monitor` 时同时输出到控制台
- **会话摘要** — 退出时输出请求数、token 消耗、重试次数、错误数和运行时长
- **每日统计** — 跨会话累计当天用量，持久化到本地文件，支持 CLI 查询历史
- **Ollama 协议兼容** — 支持 `/ollama/api/chat`、`/ollama/api/generate`、`/ollama/api/tags`、`/ollama/api/version`、`/ollama/api/show` 路由，以及 VS Code Continue.dev 等工具使用的 `/ollama/v1/chat/completions`、`/ollama/v1/models` OpenAI 兼容路径；也支持不带 `/ollama` 前缀的路径
- **Anthropic 协议兼容** — `/anthropic/v1/messages` 路由，透传 Anthropic Messages API 请求到讯飞 Anthropic 兼容端点，支持 Claude Code / Cursor（Anthropic 模式）等客户端
- **模型透传** — 白名单内的模型直接透传到讯飞上游；可通过 `XFYUN_ALLOW_CUSTOM_MODEL` 环境变量开启非白名单模型的透传
- **一键配置客户端** — `maas-coding-proxy setup` 子命令交互式引导配置 Claude Code 等客户端使用本地代理，自动检测安装、预览变更、备份并写入配置
- **实时监控面板** — 启动时自动显示 Ink TUI 面板（默认开启），展示请求速率、成功率、token 用量、并发/流式请求数、延迟统计和请求日志流；支持键盘交互：`q` 退出、`↑↓` 滚动、`←→` 翻页、`e` 切换错误日志、`r` 重置每日统计；可通过 `--no-monitor` 或 `MONITOR=false` 禁用

## 运行时要求

可根据使用方式选择对应运行时：

| 场景             | 所需运行时                     | 说明                                                                                           |
| -------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| 从当前源码仓库开发 / 调试 | **Bun** + **Node.js 20+** | `pnpm start` 和 `pnpm dev` 会直接调用 Bun；Node.js 20+ 是 `pnpm build`、打包校验以及 `dist/` 编译产物的受支持目标运行时。 |
| 运行编译产物或已发布包    | **Node.js 20+**           | 可分发入口是 `dist/index.js`，因此脱离源码开发后不再依赖 Bun。                                                    |

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

默认监听地址为 `127.0.0.1:3000`

- 对外提供的 OpenAI 兼容 Base URL 为 `http://127.0.0.1:3000/v1`
- Ollama 协议 Base URL 为 `http://127.0.0.1:3000/ollama`
- Anthropic 协议 Base URL 为 `http://127.0.0.1:3000/anthropic`

### 一键配置 Claude Code

```bash
maas-coding-proxy setup
```

交互式引导配置 Claude Code 使用本地代理：
1. 选择客户端类型（Claude Code / Cursor / Trae / OpenCode）
2. 自动检测 Claude Code 安装
3. 预览配置变更
4. 选择写入方式（settings.json 或 .env）
5. 备份原始配置并写入

非交互模式（适用于脚本化场景）：

```bash
maas-coding-proxy setup --non-interactive
```

### 查看与恢复备份

```bash
# 列出所有备份
maas-coding-proxy setup restore --list

# 交互式选择并恢复备份
maas-coding-proxy setup restore

# 直接恢复最新备份（非交互模式）
maas-coding-proxy setup restore --latest --non-interactive
```

## 全局安装

通过 npm 全局安装（无需 Bun）：[npm 包地址](https://www.npmjs.com/package/maas-coding-proxy)

```bash
npm i -g maas-coding-proxy
```

创建配置文件：

```bash
mkdir -p ~/.config/maas-coding-proxy
cp .env.example ~/.config/maas-coding-proxy/config.env
# 编辑 config.env，填入 XFYUN_API_KEY
```

启动代理：

```bash
maas-coding-proxy start
# 或使用内联参数
maas-coding-proxy start --api-key sk-xxx --port 3000
```

免安装运行：

```bash
npx maas-coding-proxy start --api-key sk-xxx
```

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

## Release 自动化

仓库采用 **tag 驱动** 的 GitHub Actions 工作流，将 npm 发布和 GitHub Release 串成同一条流水线。

1. 在 GitHub Actions Secrets 中添加 `NPM_TOKEN`。
2. 维护 `CHANGELOG.md` 中的 `## [Unreleased]` 内容。
3. 执行 `pnpm release:auto <version-or-bump> --push --yes`，自动完成测试、构建、版本升级、changelog 搬运、commit、tag 创建与推送。

tag 推送后，GitHub Actions 自动安装依赖、提取 changelog、执行 `prepublishOnly` 校验、发布 npm、创建 GitHub Release。

本地可先用 `pnpm release:auto:dry-run <version-or-bump>` 预演，不改动仓库状态。也可用 `pnpm release:prepare` 手动准备版本或 `pnpm release:dry-run` 预演。详细命令参见 `CHANGELOG.md` 或 `pnpm release:auto --help`。

## 配置

通过 `.env` 文件或环境变量配置：

| 变量                         | 默认值                                                 | 说明                     |
| -------------------------- | --------------------------------------------------- | ---------------------- |
| `PORT`                     | `3000`                                              | 代理服务监听端口               |
| `XFYUN_API_KEY`            | 必填                                                  | 讯飞 Coding Plan API Key |
| `XFYUN_BASE_URL`           | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` | 讯飞 API Base URL        |
| `XFYUN_ANTHROPIC_BASE_URL` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic` | 讯飞 Anthropic 协议端点 Base URL |
| `MAX_RETRIES`              | `3`                                                 | 最大重试次数                 |
| `RETRY_DELAY_MS`           | `1000`                                              | 初始重试延迟（ms）             |
| `XFYUN_LOG_DIR`            | XDG state 目录                                        | 日志输出目录                 |
| `MAAS_CODING_PROXY_CONFIG` | —                                                   | 自定义配置文件路径              |
| `STATS_FLUSH_INTERVAL_MS`  | `60000`                                             | 每日统计刷盘间隔（毫秒），设为 `0` 关闭 |
| `MONITOR`                  | `true`                                              | 启用实时监控面板，设为 `false` 或 `0` 关闭 |
| `STREAM_READ_TIMEOUT_MS`   | `60000`                                             | 流式 SSE 单次 read 超时（毫秒），防止上游停止发送时挂起 |
| `UPSTREAM_FETCH_TIMEOUT_MS` | `300000`                                           | 上游 fetch 总超时（毫秒），包括连接建立 + 流式传输全过程 |
| `VERBOSE`                  | `false`                                             | 启用调试日志（等同于 `--verbose`）                      |
| `DEBUG_PROXY`              | —                                                   | 设为 `1` 启用调试日志（等同于 `--debug`）                |
| `XFYUN_MID_CONVERSATION_SYSTEM` | `true`                                         | 自动将 messages 中的 `role: "system"` 提取到 `system` 字段，解决讯飞 API 不支持该格式的问题；设为 `false` 关闭 |
| `XFYUN_ALLOW_CUSTOM_MODEL` | `false`                                             | 设为 `true` 允许透传白名单外的自定义模型 ID，否则非白名单模型回退为 `astron-code-latest` |

### CLI 参数

也可以通过命令行参数配置代理：

| 参数                    | 说明                     | 默认值                                                 |
| --------------------- | ---------------------- | --------------------------------------------------- |
| `-p, --port <port>`   | 代理服务监听端口               | `3000`                                              |
| `-k, --api-key <key>` | 讯飞 Coding Plan API Key | 无                                                   |
| `--base-url <url>`    | 讯飞 API Base URL        | `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2` |
| `--anthropic-base-url <url>` | 讯飞 Anthropic API Base URL | `https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic` |
| `--max-retries <n>`   | 最大重试次数                 | `3`                                                 |
| `--retry-delay <ms>`  | 初始重试延迟（毫秒）             | `1000`                                              |
| `--log-dir <dir>`     | 日志输出目录                 | XDG state 目录                                        |
| `-c, --config <path>` | 配置文件路径                 | 自动检测                                                |
| `-v, --verbose`       | 启用调试日志                 | `false`                                             |
| `--debug`             | 启用请求/响应调试日志，写入 `logs/debug/` 目录（NDJSON 格式） | 否                                             |
| `--no-monitor`        | 禁用实时监控面板，使用普通日志输出       | 默认启用                                               |

### 配置查找顺序

配置值按以下优先级解析（从高到低）：

1. CLI 参数（`--api-key`、`--port` 等）
2. 环境变量（`XFYUN_API_KEY`、`PORT` 等）
3. `--config` 或 `$MAAS_CODING_PROXY_CONFIG` 指定的配置文件
4. `$XDG_CONFIG_HOME/maas-coding-proxy/config.env`（默认 `~/.config/maas-coding-proxy/config.env`，兼容旧目录 `~/.config/xfyun-coding-proxy/config.env`）
5. 当前工作目录下的 `.env`

## 调试

当遇到请求问题需要排查时，可启用调试日志：

```bash
maas-coding-proxy start --debug
# 或
DEBUG_PROXY=1 maas-coding-proxy start
```

调试日志以 NDJSON 格式写入 `logs/debug/YYYY-MM-DD.ndjson`，包含完整的客户端请求、上游响应和代理响应数据。

**注意：** 调试日志包含 Authorization header 等敏感信息，仅用于排查问题，生产环境不应开启。

## 用量统计

代理自动追踪每次请求的 token 用量，按天聚合并持久化到 `<logDir>/stats/YYYY-MM-DD.json`。退出时的 Session Summary 底部会显示当天累计用量。

### CLI 查询

```bash
# 查看当天用量
maas-coding-proxy stats

# 查看指定日期用量
maas-coding-proxy stats --date 2025-05-05
maas-coding-proxy stats -d 2025-05-05

# 列出所有有记录的日期
maas-coding-proxy stats --list
maas-coding-proxy stats -l
```

### 输出示例

**当天/指定日期：**

```
════════════════════════════════════════════════
  Daily Stats — 2025-05-06
════════════════════════════════════════════════
  Requests:       42
  Tokens:         23.5k(23500)
    Input:        15.0k(15000)
    Output:       8.5k(8500)
  Retries:        3
  Errors:         1
════════════════════════════════════════════════
```

**历史列表：**

```
════════════════════════════════════════════════
  Usage History
════════════════════════════════════════════════
  Date         Requests   Tokens
  2025-05-06   42         23.5k(23500)
  2025-05-05   28         15.2k(15200)
════════════════════════════════════════════════
```

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

### 自定义 OpenAI 兼容 Provider

在支持自定义 OpenAI 兼容 provider 的工具中：

- 自定义 URL 设为 `http://localhost:3000/v1/chat/completions`；
- API Key 可填写任意占位值，例如 `local-proxy`；
- 如果工具要求填写模型名，可填写 `astron-code-latest` 或任意白名单内的模型 ID。

这个代理还额外处理了与第三方工具相关的兼容问题：

- 过滤 `progress_notice`、`context_usage` 等非标准 SSE 事件，避免流式解析报错；
- 丢弃可能被讯飞上游拒绝的非标准请求头。

### Ollama 客户端（Open WebUI / Continue.dev）

代理支持 Ollama 原生协议，Ollama 客户端可将 Base URL 指向代理：

- Ollama Base URL 设为 `http://localhost:3000/ollama`
- 支持的端点：`POST /ollama/api/chat`、`POST /ollama/api/generate`、`GET /ollama/api/tags`、`GET /ollama/api/version`、`POST /ollama/api/show`、`POST /ollama/v1/chat/completions`、`GET /ollama/v1/models`
- 也支持不带 `/ollama` 前缀的路径（`/api/chat`、`/api/generate` 等），适用于 Base URL 直接设为 `http://localhost:3000` 的客户端
- 模型名通过白名单校验，白名单内的模型透传，非白名单模型回退为 `astron-code-latest`
- 流式响应使用 NDJSON 格式（`application/x-ndjson`）

Open WebUI 配置示例：将 Ollama API URL 设为 `http://localhost:3000/ollama`。

Continue.dev 配置示例见下方 VS Code 章节。

### Claude Code

将 Anthropic API 配置指向代理：

- Base URL 设为 `http://localhost:3000/anthropic`
- API Key 填写占位值（如 `local-proxy`），代理在转发时会自动替换为真实 Key
- 可通过环境变量 `ANTHROPIC_MODEL` 或模型选择器指定模型（白名单内的模型直接透传，默认使用 `astron-code-latest`）

> 也可以使用 `maas-coding-proxy setup` 命令自动完成上述配置。

### VS Code（Continue.dev / Cline / Copilot）

**Continue.dev** 配置示例（`~/.continue/config.yaml`）：

```yaml
models:
  - name: 讯飞星辰
    provider: ollama
    model: astron-code-latest
    apiBase: http://localhost:3000/ollama
    roles:
      - chat
      - edit
```

**Cline** 配置步骤：

1. 打开 Cline 侧边栏，点击设置图标
2. API Provider 选择 **Ollama**
3. Base URL 设为 `http://localhost:3000/ollama`
4. 模型选择 `astron-code-latest`

**GitHub Copilot** 自定义模型（需 VS Code 1.104+ / Insiders）：

1. 打开 Copilot Chat，点击模型选择器 → **Manage Models…**
2. 点击 **+ Add Models…**，选择 **OpenAI Compatible**
3. 输入提供商名称（如 `iFlytek`），API Key 填写占位值（如 `local-proxy`）
4. 输入自定义 Base URL: `http://localhost:3000/ollama`
5. 保存后 Copilot 会自动刷新模型列表，显示新增的模型
6. 在模型管理列表中启用该模型，即可在 Chat 模型选择器中使用

## 兼容性说明

- 代理默认仅监听 `127.0.0.1`，面向本地使用场景。
- 源码仓库的本地开发脚本依赖 Bun，而编译后的 `dist/` 产物与发布包面向 Node.js `>=20`。
- 客户端传入的模型名通过白名单校验：白名单内的模型直接透传，非白名单模型默认回退为 `astron-code-latest`；可通过 `XFYUN_ALLOW_CUSTOM_MODEL=true` 开启透传。
- 类似 `"true"` 的字符串型 `stream` 参数会被规范化为布尔值 `true`。
- 错误响应会尽量保持 OpenAI 风格的 `{ error: { message, type, code } }` 结构。
- Ollama 的 `keep_alive`、`options.top_k`、`options.num_ctx` 等本地特有参数会被静默丢弃。
- Anthropic 协议的 Extended Thinking、Vision、Tool Use 等功能均透传，不做协议转换。
- `setup` 子命令支持配置 Claude Code；`setup restore` 支持查看与恢复备份配置。
- 配置写入前会自动备份原始文件（备份文件名附加时间戳）。

## 项目结构

```
src/
├── index.ts              # CLI 入口（bin）
├── server.ts             # Fastify 服务器创建 + 启动 + 优雅关停
├── proxy.ts              # OpenAI 协议 handler（/v1/*）
├── upstream.ts           # 共享上游请求层：fetchWithRetry、SSEFilter、safeSend、handleUpstreamResult
├── errors.ts             # 错误格式化工具
├── cli.ts                # CLI 参数解析（commander 子命令）
├── config.ts             # 配置：CLI 参数 + 环境变量 + 配置发现链 + 校验
├── util.ts               # token 用量提取 + 格式化
├── debug-logger.ts       # 调试日志（NDJSON 格式写入 logs/debug/）
├── update-check.ts       # npm 版本更新检查
├── types/
│   └── openai.ts         # OpenAI 协议类型守卫
├── ollama/
│   ├── types.ts          # Ollama 协议类型定义
│   ├── request.ts        # Ollama → OpenAI 请求转换
│   ├── response.ts       # OpenAI → Ollama 响应转换（含 SSE→NDJSON）
│   └── handler.ts        # Ollama 路由 handler
├── anthropic/
│   ├── types.ts          # Anthropic 协议类型定义
│   ├── handler.ts        # Anthropic 路由 handler
│   └── system-extract.ts # 中途 system 消息提取
├── setup/
│   ├── types.ts          # 客户端类型定义与注册表
│   ├── claude-code.ts    # Claude Code 配置逻辑
│   └── restore-cmd.ts    # setup restore 子命令 handler
├── setup-cmd.ts          # setup 子命令 handler
├── monitor/
│   ├── entry.ts          # Ink 监控面板入口
│   ├── app.tsx           # MonitorApp 主组件
│   ├── header.tsx        # 顶部状态栏
│   ├── token-panel.tsx   # Token 用量面板
│   ├── request-panel.tsx # 请求状态面板
│   ├── log-stream.tsx    # 请求日志流
│   ├── footer.tsx        # 底部快捷键提示
│   ├── index.ts          # 面板组件导出
│   └── types.d.ts        # 类型声明
├── stats.ts              # 会话统计 + 退出摘要
├── stats-store.ts        # 统计数据存储
├── stats-persistence.ts  # 统计持久化（读写 JSON）
├── stats-display.ts      # 统计格式化输出
├── stats-types.ts        # 统计类型定义
├── stats-cmd.ts          # CLI stats 子命令处理
└── pretty-roll-transport.cjs # pino 日志轮转 transport
```

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
