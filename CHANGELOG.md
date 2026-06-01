# Changelog / 更新日志

本文档记录本项目的显著版本变更。

This document records notable changes to this project.

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added / 新增

### Changed / 变更

### Fixed / 修复

## [0.0.7-beta.6] - 2026-06-01

### Added / 新增

- 新增 `XFYUN_MID_CONVERSATION_SYSTEM` 环境变量配置，默认开启，自动将 Claude Code 2.1.156+ 在 messages 数组中发送的 `role: "system"` 消息提取到 `system` 字段，解决讯飞 API 不支持该格式导致的 400 错误；设为 `false` 可关闭此行为。
- Added `XFYUN_MID_CONVERSATION_SYSTEM` env config, enabled by default, which automatically extracts `role: "system"` messages from the messages array (sent by Claude Code 2.1.156+) into the `system` field, fixing the 400 error caused by xfyun API not supporting this format; set to `false` to disable.

### Changed / 变更

### Fixed / 修复

## [0.0.7-beta.5] - 2026-05-28

### Added / 新增

- 新增 `--debug` CLI 选项和 `DEBUG_PROXY=1` 环境变量，支持将完整的请求/响应数据以 NDJSON 格式写入 `logs/debug/` 目录，用于排查问题。仅用于调试，生产环境不应开启。
- Added `--debug` CLI flag and `DEBUG_PROXY=1` env var to log complete request/response data to `logs/debug/` as NDJSON files for troubleshooting. Only intended for debugging; should not be enabled in production.

### Changed / 变更

### Fixed / 修复

- 修复流式请求上游返回非 2xx 错误时，错误信息缺少讯飞错误详情（`xfyun_code` 和 `msg`）的问题，现在错误日志包含完整的错误信息便于调试。
- Fixed missing iFlytek error details (`xfyun_code` and `msg`) in stream upstream error responses when the upstream returns non-2xx status; error logs now include complete error information for easier debugging.

## [0.0.7-beta.4] - 2026-05-26

### Added / 新增

- 新增终端标题支持，启动时显示服务名和端口，退出时自动恢复。
- Added terminal title support, displaying service name and port on startup, automatically restoring on exit.
- 新增 `RingBuffer.updateFirst` 方法，用于原地更新首个匹配条目，优化请求日志更新逻辑。
- Added `RingBuffer.updateFirst` method for in-place updating the first matching entry, optimizing request log update logic.
- 新增 `safeSend` 函数，修复 HTTP 头已发送时的竞态错误（`ERR_HTTP_HEADERS_SENT`）。
- Added `safeSend` function to fix race condition errors when HTTP headers are already sent (`ERR_HTTP_HEADERS_SENT`).
- 新增 `handleUpstreamResult` 通用结果处理函数，提取各协议 handler 的错误处理逻辑。
- Added `handleUpstreamResult` generic result handler function, extracting error handling logic from protocol handlers.
- 新增 `stats-types.ts` 模块，统一管理所有统计相关类型定义。
- Added `stats-types.ts` module to centralize all statistics-related type definitions.
- 新增集成测试用例，验证端到端请求处理流程。
- Added integration test cases to verify end-to-end request processing flow.

### Changed / 变更

- 调整流式请求计数时机，从 SSE 数据传输阶段提前到请求开始时。
- Adjusted streaming request counting timing, moving from SSE data transmission phase to request start.
- 所有错误日志和完成日志新增 `ua` 字段，便于排查客户端来源。
- Added `ua` field to all error and completion logs for easier client source identification.
- 将 `stats.ts` 拆分为 `stats-store`、`stats-persistence`、`stats-display` 三个独立模块，优化代码结构。
- Split `stats.ts` into three independent modules: `stats-store`, `stats-persistence`, `stats-display` for better code organization.
- 优化 `isRetryableXfyunError` 函数，优先使用 JSON parse 确保准确性，失败时 fallback 到字符串匹配。
- Optimized `isRetryableXfyunError` function to prioritize JSON parse for accuracy, falling back to string matching on failure.
- 将 ink 相关依赖移至 `optionalDependencies`，减少必装依赖体积。
- Moved ink-related dependencies to `optionalDependencies` to reduce required dependency size.
- 升级 ESLint 规则，将 `no-explicit-any` 设为 error 级别。
- Upgraded ESLint rule, setting `no-explicit-any` to error level.
- 简化 fetch 请求的超时处理逻辑。
- Simplified fetch request timeout handling logic.

### Fixed / 修复

- 修复 HTTP 头已发送时的竞态错误，使用 `safeSend` 函数确保客户端始终收到错误信息。
- Fixed race condition error when HTTP headers are already sent, using `safeSend` function to ensure clients always receive error information.
- 修复请求日志更新逻辑，使用 `updateFirst` 原地更新 pending 请求而非重复 push。
- Fixed request log update logic, using `updateFirst` to in-place update pending requests instead of duplicate pushing.

## [0.0.7-beta.3] - 2026-05-22

### Added / 新增

- 新增 `UPSTREAM_FETCH_TIMEOUT_MS` 配置项，支持自定义上游请求总超时。
- Added `UPSTREAM_FETCH_TIMEOUT_MS` config option for customizing upstream request total timeout.
- 新增 `readBodyWithLimit` 工具函数，防止上游超大响应导致 OOM。
- Added `readBodyWithLimit` utility function to prevent OOM from oversized upstream responses.
- 新增 SSE 解析工具函数与单元测试，完善讯飞字段清理逻辑。
- Added SSE parsing utility functions and unit tests, improved iFlytek field cleanup logic.
- 新增异步保存接口，避免统计持久化阻塞事件循环。
- Added async save interface to prevent stats persistence from blocking the event loop.
- 新增 `safeParseOpenAIError` 和 `safeParseAnthropicError`，统一转换错误格式。
- Added `safeParseOpenAIError` and `safeParseAnthropicError` for unified error format conversion.
- 新增重置会话统计函数与持久化回调。
- Added session stats reset function and persistence callback.
- 新增按日统计、跨天自动翻转、格式化输出优化。
- Added daily statistics, cross-day auto-rollover, and formatted output optimization.

### Changed / 变更

- 重构版本号读取逻辑，提取为 CLI 工具函数避免重复读取 `package.json`。
- Refactored version reading logic, extracted into CLI utility to avoid repeated `package.json` reads.
- 大幅优化请求转发流程：延迟写入响应头，统一使用 `extractUpstreamHeaders` 处理转发头。
- Significantly optimized request forwarding: delayed response header writing, unified `extractUpstreamHeaders` for forwarding headers.
- 重构 `cleanXfyunFields` 逻辑，使用 `JSON.parse` 替代正则避免转义引号问题。
- Refactored `cleanXfyunFields` logic, using `JSON.parse` instead of regex to avoid escaped quote issues.
- 重构 Ollama 代理逻辑，统一使用 `upstreamRequest` 处理请求，大幅简化代码量。
- Refactored Ollama proxy logic, unified to use `upstreamRequest` for requests, significantly reducing code complexity.
- 重构 stats 模块，新增按日统计、跨天自动翻转、格式化输出优化。
- Refactored stats module with daily statistics, cross-day auto-rollover, and formatted output optimization.
- 为代理/Anthropic/Ollama 处理添加流式请求错误兼容逻辑。
- Added streaming request error compatibility logic for proxy/Anthropic/Ollama handlers.
- 升级测试用例，替换 Vitest 为 Bun test 并补充统计相关测试。
- Upgraded test cases, replaced Vitest with Bun test and added statistics-related tests.

### Fixed / 修复

- 修复版本解析逻辑，非数字版本段默认转为 0 避免 NaN 错误。
- Fixed version parsing logic, non-numeric version segments default to 0 to avoid NaN errors.
- 修复 Claude 配置读取的返回结构，统一返回格式包含解析失败标记。
- Fixed Claude config reading return structure, unified return format includes parse failure flag.
- 为上游非 JSON 响应添加解析失败处理逻辑。
- Added parse failure handling logic for non-JSON upstream responses.
- 修复流式请求错误处理，向客户端返回详细错误信息。
- Fixed streaming request error handling, returns detailed error info to clients.
- 为 GET 代理添加重试机制与完整的错误处理流程。
- Added retry mechanism and complete error handling flow for GET proxy.

## [0.0.7-beta.2] - 2026-05-21

### Added / 新增

### Changed / 变更

### Fixed / 修复

- `saveDailyStatsForce` 采用读-改-写合并策略，先读取文件已有数据与内存数据按字段取较大值合并后再写入，防止并发或外部恢复数据被覆写丢失。
- `saveDailyStatsForce` now uses read-merge-write strategy: reads existing file data, merges with in-memory data by taking the larger value per field, then writes — prevents data loss from concurrent writes or external recovery.
- 保存后和初始化后清除 `dailyStatsDirty`，避免无请求时重复覆写已有持久化数据。
- Clear `dailyStatsDirty` after saving and initialization to avoid redundant overwrites of existing persisted data when no requests occurred.
- `resetDailyStats` 后置脏标记，确保重置操作能触发持久化。
- Set `dailyStatsDirty` after `resetDailyStats` to ensure the reset triggers persistence.
- `saveDailyStats` 仅对全局 `dailyStats` 使用脏标记守卫，外部传入的 stats 对象（如测试、rollover）无条件保存。
- `saveDailyStats` only guards with the dirty flag for the global `dailyStats`; externally passed stats objects (e.g. tests, rollover) are saved unconditionally.

## [0.0.7-beta.1] - 2026-05-20

### Changed / 变更

- 迁移至 ESM 模块系统，移除 CJS 桥接层，统一使用 import/import.meta。
- Migrated to ESM module system, removed CJS bridge layer, unified to import/import.meta.
- 重构构建流程：新增 `scripts/build.ts`，使用 bun build 生成单文件 ESM bundle + tsc API 生成声明文件。
- Refactored build pipeline: added `scripts/build.ts`, using bun build for single-file ESM bundle + tsc API for declarations.
- `stats.ts` 添加 `dailyStatsDirty` 脏标记，避免无请求时覆写已有持久化数据。
- Added `dailyStatsDirty` flag in `stats.ts` to avoid overwriting existing persisted data when no requests occurred.
- `util.ts` 移除 Bun 特有类型，改用标准 `ReadableStreamReadResult`。
- Removed Bun-specific types in `util.ts`, switched to standard `ReadableStreamReadResult`.
- 最低 Node.js 版本要求提升至 20.11（需 `import.meta.dirname` 支持）。
- Raised minimum Node.js version requirement to 20.11 (requires `import.meta.dirname` support).
- `pretty-roll-transport.js` 重命名为 `.cjs`（pino Worker Thread 需要 CJS 格式）。
- Renamed `pretty-roll-transport.js` to `.cjs` (pino Worker Thread requires CJS format).

### Removed / 移除

- 移除 monitor CJS 桥接层，改为 ESM 直接 import。
- Removed monitor CJS bridge layer, replaced with direct ESM import.

### Fixed / 修复

## [0.0.6-beta.5] - 2026-05-19

### Added / 新增

- 监控面板 Token 用量区新增今日总令牌数显示（prompt + completion 合计）。
- Token usage panel now shows today's total token count (prompt + completion combined).

### Changed / 变更

- 调整日志流错误标签的文本拼接格式。
- Adjusted text concatenation format for error tab label in log stream.

### Fixed / 修复

## [0.0.6-beta.4] - 2026-05-15

### Added / 新增

- 新增 `XFYUN_API_KEY` 环境变量必填校验，启动时缺失则报错退出。
- Added required validation for `XFYUN_API_KEY` env var; exits with error if missing at startup.
- 新增 `MONITOR` 环境变量控制是否启用 Ink 实时监控面板。
- Added `MONITOR` env var to toggle the Ink real-time monitoring panel.
- 新增端口范围校验，`PORT` 环境变量超出 1-65535 范围时报错。
- Added port range validation; errors when `PORT` env var is outside 1–65535.
- 新增版本更新检查功能，启动时检测 npm registry 是否有新版本并提示。
- Added update check on startup; notifies when a newer version is available on npm.
- 新增发布冒烟测试脚本 `smoke-test.mjs`，验证源码和构建产物均能正常启动并监听端口。
- Added release smoke test script `smoke-test.mjs` to verify both source and dist builds start and listen on the expected port.
- Token 用量面板新增 prompt / completion 分项显示及占比百分比。
- Token usage panel now shows prompt/completion breakdown with percentage.

### Changed / 变更

- 监控面板布局重构，优化组件排列与信息展示。
- Refactored monitoring panel layout for improved component arrangement and information display.
- `release:auto` 流程在 `pnpm test` 后插入源码冒烟测试，在 `pnpm build` 后插入构建产物冒烟测试。
- `release:auto` now runs source smoke test after `pnpm test` and dist smoke test after `pnpm build`.

### Fixed / 修复

## [0.0.6-beta.3] - 2026-05-14

### Added / 新增

### Changed / 变更

### Fixed / 修复

- 修复端口占用时进程静默崩溃无错误输出的问题，现在会输出 `Error: Port XXXX is already in use` 并提示使用 `--port` 指定其他端口。
- Fixed silent crash on port-in-use error; now prints `Error: Port XXXX is already in use` and suggests `--port` flag.
- 修复 Node.js 运行 dist 包时 Ink 监控面板数据为空的问题，根因是 bun 打包将 `stats.ts` 内联进 `monitor.mjs` 导致面板持有独立的状态副本，与主进程的 `statsEmitter` 事件和统计数据互不相通。现改为通过 `startMonitor` 参数注入主进程的 stats 依赖。
- Fixed Ink monitor dashboard showing empty data when running the dist build under Node.js; root cause was bun bundler inlining `stats.ts` into `monitor.mjs`, creating a separate stats instance disconnected from the main process. Now stats dependencies are injected via `startMonitor` parameters.

## [0.0.6-beta.2] - 2026-05-14

### Added / 新增

### Changed / 变更

### Fixed / 修复

- 修复发布产物中监控面板的加载路径与旧 CJS 产物残留问题，Node 启动现已正确加载 `dist/monitor.mjs`，构建前也会清理旧的 `dist/monitor/*` 文件。
- Fixed the monitor dashboard loading path and stale CJS artifact issue in the published build; Node startup now loads `dist/monitor.mjs` correctly, and the build clears old `dist/monitor/*` files first.

## [0.0.6-beta.1] - 2026-05-14

### Added / 新增

- 新增 Ink 实时监控面板，启动时自动显示（默认开启），展示请求速率、成功率、token 用量、并发/延迟统计和请求日志流，支持键盘交互（q 退出、↑↓ 滚动、←→ 翻页、e 切换错误日志、r 重置每日统计）。
- Added Ink real-time monitor dashboard (enabled by default on startup), showing request rate, success rate, token usage, concurrent/streaming counts, latency stats, and request log stream, with keyboard interaction (q quit, ↑↓ scroll, ←→ page, e toggle error logs, r reset daily stats).
- 新增 `--no-monitor` CLI 选项和 `MONITOR` 环境变量，支持禁用实时监控面板。
- Added `--no-monitor` CLI flag and `MONITOR` environment variable to disable the real-time monitor dashboard.
- 新增 `STREAM_READ_TIMEOUT_MS` 环境变量，配置流式 SSE 单次 read 超时（默认 60s），防止上游停止发送数据时 `reader.read()` 无限挂起。
- Added `STREAM_READ_TIMEOUT_MS` environment variable for configuring per-read timeout on streaming SSE (default 60s), preventing `reader.read()` from hanging indefinitely when upstream stalls.
- 新增 `readWithTimeout()` 工具函数，为 `ReadableStreamDefaultReader.read()` 添加超时保护。
- Added `readWithTimeout()` utility function that adds timeout protection to `ReadableStreamDefaultReader.read()`.
- 新增 `statsEmitter` 事件系统（`request:start` / `request:complete`），替代各 handler 中分散的统计更新调用，实现集中式事件驱动记录。
- Added `statsEmitter` event system (`request:start` / `request:complete`) replacing scattered stats updates across handlers with centralized event-driven recording.
- 新增并发/流式请求追踪（`requestStarted` / `requestFinished` / `streamingStarted` / `streamingFinished`），供监控面板实时展示活跃请求数。
- Added concurrent/streaming request tracking (`requestStarted` / `requestFinished` / `streamingStarted` / `streamingFinished`) for real-time active request count display on the monitor panel.
- 新增延迟滑动窗口统计（`getLatencyStats`），计算最近 1000 次请求的平均延迟和 P95 延迟。
- Added sliding-window latency stats (`getLatencyStats`) computing average and P95 latency over the last 1000 requests.
- 新增请求日志环形缓冲区（`getRequestLog`），保留最近 100 条请求记录（含 pending 状态），供监控面板实时展示。
- Added ring-buffer request log (`getRequestLog`) retaining the last 100 request records (including pending entries) for real-time display on the monitor panel.
- 新增 `resetDailyStats()` 函数，支持监控面板按 `r` 键重置当日统计。
- Added `resetDailyStats()` function enabling the monitor panel to reset daily stats via the `r` key.
- 新增 `RequestDiagnostics` 接口和 `summarizeRequestDiagnostics()` 函数，提取请求的诊断信息（模型、流状态、消息数量、content 类型、工具数量、请求大小）。
- Added `RequestDiagnostics` interface and `summarizeRequestDiagnostics()` function extracting request diagnostic info (model, stream state, message count, content types, tool count, request size).
- 新增 `src/errors.ts`，定义 `UpstreamError`、`StreamInterruptedError`、`NetworkError` 错误类和 `formatOpenAIError` / `formatAnthropicError` 格式化函数，统一各协议错误响应格式。
- Added `src/errors.ts` defining `UpstreamError`, `StreamInterruptedError`, `NetworkError` error classes and `formatOpenAIError` / `formatAnthropicError` formatting functions for unified protocol-specific error responses.
- 新增 `src/types/openai.ts`，定义 OpenAI 聊天完成请求/响应类型（`ChatCompletionRequest`、`ChatCompletionResponse`、`ChatCompletionChunk` 等）及类型保护函数。
- Added `src/types/openai.ts` defining OpenAI chat completion request/response types (`ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk`, etc.) and type guard functions.
- 新增配置 Schema 校验（基于 `zod`），启动时自动验证配置项格式和范围，替代原有的手动 `validateConfig()`。
- Added config schema validation (via `zod`) that automatically validates config field formats and ranges on startup, replacing the manual `validateConfig()` function.

### Changed / 变更

- 将 `src/proxy.ts` 中的共享上游逻辑（重试、SSE 过滤、讯飞字段清理、请求构建）提取到 `src/upstream.ts`，三个协议 handler 统一通过 `upstreamRequest()` 发起上游请求。
- Extracted shared upstream logic (retry, SSE filtering, iFlytek field cleanup, request building) from `src/proxy.ts` into `src/upstream.ts`; all three protocol handlers now use `upstreamRequest()` to make upstream requests.
- `src/proxy.ts` 从 400+ 行精简为路由分发 + 错误格式化，核心请求处理逻辑迁移至 `src/upstream.ts`。
- Simplified `src/proxy.ts` from 400+ lines to route dispatch + error formatting; core request handling logic moved to `src/upstream.ts`.
- `fmtTokens()` 支持百万级数字格式化（`1.2M`），括号内原始值使用千分位分隔符。
- `fmtTokens()` now supports million-scale formatting (`1.2M`) with thousands-separated raw values in parentheses.
- Session Summary 按协议维度逐行展示请求数、token 消耗和错误数，替代原有的单行汇总格式。
- Session Summary now displays per-protocol request count, token usage, and errors line by line, replacing the previous single-line summary format.
- Ink 监控模式下移除 pino console transport（仅保留文件 transport），避免终端输出破坏 Ink TUI 渲染。
- Removed pino console transport in Ink monitor mode (keeping only file transport) to prevent terminal output from corrupting Ink TUI rendering.
- 错误处理器增加兜底逻辑：handler 中未调用 `recordRequestComplete` 时（如未捕获异常或 body 解析失败），由全局错误处理器补调，确保统计和日志状态正确更新。
- Added fallback logic in the error handler: when handlers fail to call `recordRequestComplete` (e.g. uncaught exceptions or body parse failures), the global error handler compensates to ensure stats and log state are correctly updated.
- 启动日志从 `maas-coding-proxy vX.Y.Z` 改为使用 `package.json` 中的 `name` 字段动态显示。
- Startup log now dynamically displays the `name` field from `package.json` instead of hardcoded `maas-coding-proxy`.

### Fixed / 修复

## [0.0.5-beta.8] - 2026-05-12

### Added / 新增

- 新增 Anthropic 协议 `count_tokens` 端点（`POST /anthropic/v1/messages/count_tokens`），按 1 token ≈ 4 字符本地估算输入 token 数。
- Added Anthropic protocol `count_tokens` endpoint (`POST /anthropic/v1/messages/count_tokens`), estimating input tokens locally at ~1 token per 4 characters.
- 新增 `HEAD /anthropic` 路由，支持客户端启动时的连通性探测。
- Added `HEAD /anthropic` route for client connectivity probes on startup.

### Changed / 变更

- 重构 `handleProxy` 和 `handleGetProxy` 中的协议统计逻辑，根据请求路径前缀动态判断协议归属。
- Refactored protocol stats logic in `handleProxy` and `handleGetProxy` to dynamically determine protocol based on request path prefix.

### Fixed / 修复

- 修复 `/ollama/v1/chat/completions` 和 `/ollama/v1/models` 请求被错误归入 OpenAI 协议统计的问题，现在正确归入 Ollama 统计。
- Fixed `/ollama/v1/chat/completions` and `/ollama/v1/models` requests being incorrectly counted under OpenAI protocol stats; they now correctly count under Ollama.
- 修复多次 Ctrl+C 无法退出程序的问题，首次信号执行优雅关停，再次收到信号则强制退出。
- Fixed the issue where multiple Ctrl+C presses failed to exit the program; the first signal triggers graceful shutdown, subsequent signals force exit.

## [0.0.5-beta.7] - 2026-05-12

### Added / 新增

- 新增 `-v` / `--version` 命令行参数，输出当前版本号。
- Added `-v` / `--version` CLI flag to print the current version.
- 新增启动时输出版本信息（`maas-coding-proxy vX.Y.Z`）。
- Added version info output on server startup (`maas-coding-proxy vX.Y.Z`).

### Changed / 变更

- `--verbose` 选项移除 `-v` 短标志，改为仅支持 `--verbose`（`-v` 现用于 `--version`）。
- Removed `-v` short flag from `--verbose` option; now only `--verbose` is accepted (`-v` is now used for `--version`).

### Fixed / 修复

## [0.0.5-beta.6] - 2026-05-12

### Added / 新增

- 请求入口日志新增 `user-agent` 字段，便于识别客户端来源（Claude Code、Cursor、VS Code 等）。
- Added `user-agent` field to request entry logs for identifying client source (Claude Code, Cursor, VS Code, etc.).
- Session Summary 新增日期范围显示，跨天会话显示为 `2026-05-11 ~ 2026-05-12`。
- Added date range display to Session Summary; cross-day sessions show as `2026-05-11 ~ 2026-05-12`.

### Changed / 变更

- HTTP 500 加入自动重试条件（讯飞上游超时返回 500 是暂时性的）。
- Added HTTP 500 to auto-retry conditions (iFlytek upstream timeouts returning 500 are transient).
- Fastify `requestTimeout` 从 60s 调整为 180s，确保大于 fetch 上游超时 120s，避免 Fastify 先于 fetch 中断请求。
- Increased Fastify `requestTimeout` from 60s to 180s, ensuring it exceeds the fetch upstream timeout of 120s to prevent premature request termination.

### Fixed / 修复

- 修复上游网络异常（超时、DNS 失败等）时错误响应格式与协议不匹配的问题：三个协议 handler 现在各自捕获 `fetchWithRetry` 异常并返回对应格式错误（Anthropic → `{ type: 'error', error: {...} }`，OpenAI → `{ error: {...} }`，Ollama → `{ error: '...' }`），之前异常被 Fastify 全局 handler 捕获后统一返回 OpenAI 格式，导致 Anthropic/Ollama 客户端无法正确解析。
- Fixed error response format mismatch on upstream network failures (timeout, DNS, etc.): each protocol handler now catches `fetchWithRetry` exceptions and returns protocol-specific error formats (Anthropic → `{ type: 'error', error: {...} }`, OpenAI → `{ error: {...} }`, Ollama → `{ error: '...' }`). Previously, exceptions were caught by the Fastify global handler and always returned in OpenAI format, causing Anthropic/Ollama clients to fail parsing.
- 修复跨天会话统计汇总始终显示启动日期的问题：新增 `rolloverDailyStats` 在每次请求入口和定时刷盘时检测日期翻转，跨天时先持久化旧数据再重置为新一天。
- Fixed cross-day session summary always showing the startup date: added `rolloverDailyStats` that checks for date rollover on each request and periodic flush, persisting old data and resetting for the new day when a date change is detected.

## [0.0.5-beta.5] - 2026-05-12

### Added / 新增

- 新增启动时版本更新检查：代理启动后异步查询 npm registry 最新版本，发现新版本时在终端输出黄色提示（`Update available: X → Y`），引导用户执行 `npm i -g maas-coding-proxy` 升级。
- Added startup version update check: after the proxy starts, it asynchronously queries the npm registry for the latest version and prints a yellow hint (`Update available: X → Y`) when an update is available, guiding users to upgrade via `npm i -g maas-coding-proxy`.
- 新增 `NO_UPDATE_CHECK` 环境变量，设为非空值时跳过更新检查，适用于 CI/CD 或离线环境。
- Added `NO_UPDATE_CHECK` environment variable; set to any non-empty value to skip the update check, useful for CI/CD or offline environments.
- 更新检查结果缓存到 `{logDir}/.update-check.json`，24 小时内不重复请求 registry，缓存文件损坏时自动删除并重试。
- Update check results are cached in `{logDir}/.update-check.json`; the registry is not queried more than once per 24 hours, and corrupted cache files are automatically deleted and retried.

### Changed / 变更

### Fixed / 修复

## [0.0.5-beta.4] - 2026-05-11

### Added / 新增

- 新增按代理协议维度（OpenAI / Anthropic / Ollama）的用量统计，`stats` 子命令和会话退出摘要中展示 `By Protocol` 区块，历史列表新增 `Protocols` 列。
- Added per-protocol (OpenAI / Anthropic / Ollama) usage statistics, with a `By Protocol` section in the `stats` subcommand and session exit summary, and a `Protocols` column in the history listing.
- 统计数据文件新增 `protocols` 字段，按协议分别记录请求数、token 消耗、重试与错误数；旧格式文件自动兼容（`protocols` 缺失时视为空）。
- Added `protocols` field to stats data files, recording request count, token usage, retries, and errors per protocol; old format files are automatically compatible (missing `protocols` defaults to empty).

### Changed / 变更

- Token 格式化中括号内的原始值使用千分位分隔符（如 `16,518,011`），提升大数字可读性。
- Formatted raw values in parentheses of token display with thousands separators (e.g. `16,518,011`) for better readability of large numbers.
- 启动日志为 `/v1/*` 转发路径增加 `(OpenAI protocol)` 标识，与 Ollama 和 Anthropic 日志格式统一。
- Added `(OpenAI protocol)` label to the `/v1/*` forwarding startup log, consistent with Ollama and Anthropic log format.

### Fixed / 修复

## [0.0.5-beta.3] - 2026-05-11

### Added / 新增

- 新增 Anthropic Messages API 协议路由（`POST /anthropic/v1/messages`、`GET /anthropic/v1/models`），支持 Claude Code、Cursor 等 Anthropic 协议客户端直接接入，自动将请求转发到讯飞 Anthropic 协议端点。
- Added Anthropic Messages API protocol routes (`POST /anthropic/v1/messages`, `GET /anthropic/v1/models`) enabling Claude Code, Cursor, and other Anthropic-protocol clients to connect directly, forwarding requests to the iFlytek Anthropic protocol endpoint.
- 新增 Anthropic SSE 事件白名单（`ANTHROPIC_SSE_EVENTS`），过滤 `progress_notice`、`context_usage` 等非标准事件，只转发 Anthropic 标准事件类型（`message_start`、`content_block_delta`、`message_delta` 等）。
- Added Anthropic SSE event whitelist (`ANTHROPIC_SSE_EVENTS`) that filters non-standard events like `progress_notice` and `context_usage`, forwarding only standard Anthropic event types (`message_start`, `content_block_delta`, `message_delta`, etc.).
- 新增 Anthropic 协议 token 用量提取（`input_tokens` / `output_tokens`），支持流式和非流式响应的用量统计。
- Added Anthropic protocol token usage extraction (`input_tokens` / `output_tokens`) with support for both streaming and non-streaming response usage statistics.
- 新增 `XFYUN_ANTHROPIC_BASE_URL` 配置项和 `--anthropic-base-url` CLI 选项，支持自定义讯飞 Anthropic 协议端点地址。
- Added `XFYUN_ANTHROPIC_BASE_URL` config option and `--anthropic-base-url` CLI flag for customizing the iFlytek Anthropic protocol endpoint URL.
- 新增 `setup` CLI 子命令，交互式一键配置 AI 编程工具使用本地代理，当前支持 Claude Code（自动写入 `settings.json` 或 `.env`，含备份机制）。
- Added `setup` CLI subcommand for interactive one-click configuration of AI coding tools to use the local proxy, currently supporting Claude Code (auto-writing `settings.json` or `.env` with backup mechanism).
- 新增 `setup restore` CLI 子命令，支持查看和恢复由 `setup` 命令创建的配置备份文件。
- Added `setup restore` CLI subcommand to view and restore configuration backup files created by the `setup` command.
- 新增 `--non-interactive` 选项，支持在 CI/CD 等非交互环境中自动执行 `setup` 和 `setup restore`。
- Added `--non-interactive` option for running `setup` and `setup restore` automatically in CI/CD and other non-interactive environments.

### Changed / 变更

- `SSEFilter` 构造函数新增可选 `allowedEvents` 参数，支持不同协议使用不同的 SSE 事件白名单（OpenAI 用 `['message']`，Anthropic 用 7 种标准事件类型）。
- `SSEFilter` constructor now accepts an optional `allowedEvents` parameter, allowing different protocols to use different SSE event whitelists (OpenAI uses `['message']`, Anthropic uses 7 standard event types).
- Ollama 请求/响应转换模块统一使用 `DEFAULT_MODEL` 常量替代硬编码模型名。
- Ollama request/response conversion modules now use the `DEFAULT_MODEL` constant instead of hardcoded model names.
- 启动日志新增 Anthropic 协议转发目标地址输出。
- Startup logs now include the Anthropic protocol forwarding target URL.

### Fixed / 修复

## [0.0.5-beta.2] - 2026-05-11

### Added / 新增

- 新增 VS Code GitHub Copilot 自定义模型配置示例，支持通过 OpenAI Compatible 供应商接入代理。
- Added VS Code GitHub Copilot custom model configuration example, supporting proxy connection via the OpenAI Compatible provider.

### Changed / 变更

### Fixed / 修复

## [0.0.5-beta.1] - 2026-05-09

### Added / 新增

- 新增 Ollama 协议兼容路由（`/ollama/api/chat`、`/ollama/api/generate`、`/ollama/api/tags`、`/ollama/api/show`、`/ollama/api/version`），自动将 Ollama 原生请求转换为 OpenAI 格式转发，响应转换回 Ollama NDJSON 格式，支持 Open WebUI、Continue.dev、Cline 等 Ollama 客户端直接接入。
- Added Ollama protocol routes (`/ollama/api/chat`, `/ollama/api/generate`, `/ollama/api/tags`, `/ollama/api/show`, `/ollama/api/version`) that automatically convert Ollama native requests to OpenAI format for forwarding and convert responses back to Ollama NDJSON format, enabling direct integration with Open WebUI, Continue.dev, Cline, and other Ollama clients.
- 新增不带 `/ollama` 前缀的 Ollama 路由（`/api/chat`、`/api/generate`、`/api/tags`、`/api/show`、`/api/version`），兼容 Base URL 直接指向代理根路径的工具。
- Added Ollama routes without the `/ollama` prefix (`/api/chat`, `/api/generate`, `/api/tags`, `/api/show`, `/api/version`) for tools that point the Base URL directly to the proxy root.
- 新增 `/ollama/v1/chat/completions` 和 `/ollama/v1/models` 路由，兼容 VS Code Continue.dev 等工具在 Ollama 模式下使用的 OpenAI 兼容路径。
- Added `/ollama/v1/chat/completions` and `/ollama/v1/models` routes for VS Code Continue.dev and similar tools that use OpenAI-compatible paths under Ollama mode.
- 新增 `extractStreamUsage()` 函数，从 SSE rawChunk 中提取 token 用量，支持标准 OpenAI usage 格式和讯飞 `context_usage` 事件格式。
- Added `extractStreamUsage()` function to extract token usage from SSE rawChunks, supporting both standard OpenAI usage format and iFlytek `context_usage` event format.

### Changed / 变更

- 路径重写 `rewritePath()` 新增 `/ollama/v1/*` → `/v1/*` → 上游 `/v2/*` 的两步重写，确保 VS Code Ollama OpenAI 兼容路径正确转发。
- Path rewriting `rewritePath()` now handles `/ollama/v1/*` → `/v1/*` → upstream `/v2/*` in two steps, ensuring VS Code Ollama OpenAI-compatible paths are forwarded correctly.
- `fetchWithRetry()` 从私有函数改为导出函数，供 Ollama handler 复用。
- Changed `fetchWithRetry()` from a private function to an exported function for reuse by the Ollama handler.
- `/api/tags` 和 `/ollama/api/tags` 改为直接返回 mock 数据（模型 `astron-code-latest`），不再请求上游 `/v1/models`。
- Changed `/api/tags` and `/ollama/api/tags` to return mock data directly (model `astron-code-latest`) instead of proxying to upstream `/v1/models`.
- `/api/show` 和 `/ollama/api/show` 返回 mock 模型详情，`astron.context_length` 设为 192000（192k）。
- `/api/show` and `/ollama/api/show` now return mock model details with `astron.context_length` set to 192000 (192k).

### Fixed / 修复

- 修复流式响应 token 用量日志始终显示 `in=0 out=0 total=0` 的问题：讯飞上游在每个 SSE chunk 中包含 `usage`（中间 chunk 为 0，最后 chunk 为真实值），全局匹配取最后一个非零结果，避免中间 chunk 的 0 值覆盖真实值。
- Fixed stream response token usage logs always showing `in=0 out=0 total=0`: iFlytek upstream includes `usage` in every SSE chunk (intermediate chunks have 0, the final chunk has real values); now uses global regex matching to take the last non-zero result, preventing intermediate 0 values from overwriting real values.
- 修复 `context_usage` 事件中 `"tokens":N` 被误匹配为 `"total_tokens":0` 的问题，改用 lookbehind 正则 `(?<!total_)"tokens"` 精确匹配独立 `"tokens"` key。
- Fixed `"tokens":N` in `context_usage` events being incorrectly matched as `"total_tokens":0`; now uses a lookbehind regex `(?<!total_)"tokens"` to precisely match the standalone `"tokens"` key.

## [0.0.5-alpha] - 2026-05-07

### Added / 新增

- 新增 `extractXfyunError()` 工具函数，从讯飞响应体中提取错误码、错误消息和 Sid，支持多种格式（`{"code":10012,"msg":"..."}`、`{"error":{"code":"ModelArts.81001",...}}`、SSE `data:{"error":{...}}`）。
- Added `extractXfyunError()` utility to extract error code, message, and Sid from iFlytek response bodies, supporting multiple formats.
- 新增 `summarizeContentTypes()` 工具函数，在请求入口日志中展示 messages 的 content 类型分布（如 `3 msgs: 2 text, 1 image_url`），便于排查 image_url 等不支持的 content type 问题。
- Added `summarizeContentTypes()` utility to show content type distribution in request entry logs (e.g. `3 msgs: 2 text, 1 image_url`), helping diagnose unsupported content type issues.
- 新增请求入口日志，记录请求路径、stream 模式和 content 类型分布。
- Added request entry log showing path, stream mode, and content type distribution.

### Changed / 变更

- SSE 事件过滤策略从黑名单（`BLOCKED_SSE_EVENTS`）改为白名单（`ALLOWED_SSE_EVENTS`），只转发标准 OpenAI 事件类型（`message`），其余全部丢弃。防止讯飞新增任何非标准事件类型导致 Trae IDE 报 4054 错误。
- Changed SSE event filtering from blocklist (`BLOCKED_SSE_EVENTS`) to allowlist (`ALLOWED_SSE_EVENTS`), only forwarding standard OpenAI event type (`message`). Prevents Trae IDE 4054 errors from any new non-standard event types iFlytek may introduce.
- 流式请求超时或异常时，向 SSE 流写入 OpenAI 兼容的错误事件（`{"error":{"message":"stream interrupted: ..."}}`）+ `[DONE]`，让客户端能识别流异常终止而非收到空内容。
- On stream timeout or error, writes an OpenAI-compatible error event (`{"error":{"message":"stream interrupted: ..."}}`) + `[DONE]` to the SSE stream, so clients can detect abnormal termination instead of receiving empty content.
- 流中检测到讯飞错误（10012/11210 等）时主动 `break` 结束流，不再继续等待后续数据。
- When iFlytek errors (10012/11210 etc.) are detected in stream, actively `break` to end the stream instead of continuing to wait.
- 所有错误日志和重试日志新增 `sid=` 字段，Sid 是关联讯飞侧日志的关键标识。
- Added `sid=` field to all error and retry logs; Sid is the key identifier for correlating iFlytek-side logs.
- 非流式上游错误日志新增讯飞错误码和消息提取（`xfyun_code=... msg=...`），不再只记录原始 body。
- Non-stream upstream error logs now include extracted iFlytek error code and message (`xfyun_code=... msg=...`) instead of only raw body.
- 重试日志中的讯飞错误原因从 `xfyun code in body` 改为具体的 `xfyun_code=... msg=... sid=...`。
- Retry logs now show specific `xfyun_code=... msg=... sid=...` instead of generic `xfyun code in body`.

### Fixed / 修复

- 修复对讯飞业务错误码 `10012` 的重试判断：HTTP 4xx 客户端错误（如 400 Bad Request）不再因响应体包含 10012 而被误判为可重试，避免对不支持的 content type 等客户端错误进行无效重试。
- Fixed retry classification for iFlytek error code `10012`: HTTP 4xx client errors (e.g. 400 Bad Request) are no longer retried just because the response body contains 10012, avoiding wasted retries on client errors like unsupported content types.
- 修复非流式请求上游返回空 body 时 `JSON.parse(null)` 崩溃的问题，改为返回 OpenAI 格式错误响应。
- Fixed `JSON.parse(null)` crash when non-stream upstream returns empty body; now returns an OpenAI-format error response.
- 修复流式请求上游返回非 2xx 且无 body 时 `response.body.getReader()` 崩溃的问题，改为返回 OpenAI 格式错误响应。
- Fixed `response.body.getReader()` crash when stream upstream returns non-2xx with no body; now returns an OpenAI-format error response.

## [0.0.4-alpha] - 2026-05-06

### Added / 新增

- release 相关 skill（release、release-dry-run、release-audit）新增发布前敏感信息检查，扫描 `package.json` `files` 字段包含的文件及 `src/` 源码，防止真实密钥、私钥或 JWT 泄露到 npm 发布包。
- Added pre-release sensitive information check to release skills (release, release-dry-run, release-audit), scanning published files and source code for real API keys, private keys, or JWTs.
- release skill 新增发布时同步 `README.md` 和 `docs/README.en.md` 版本号的步骤。
- Added step to sync version numbers in `README.md` and `docs/README.en.md` during release.
- release-dry-run 和 release-audit 新增 README 版本号一致性检查。
- Added README version consistency check to release-dry-run and release-audit.
- `src/pretty-roll-transport.js` 纳入 git 跟踪，确保 GitHub 拉取源码后 `pnpm dev` / `pnpm start` 可正常使用 pino 日志轮转。
- Added `src/pretty-roll-transport.js` to git tracking so `pnpm dev` / `pnpm start` work correctly after cloning from GitHub.

### Changed / 变更

### Fixed / 修复

- 修复 `pnpm build` 后 `dist/` 中缺少 `pretty-roll-transport.js` 导致 npm 安装用户 pino 日志轮转报错的问题，build 脚本现在会自动复制该文件。
- Fixed missing `pretty-roll-transport.js` in `dist/` after `pnpm build`, which caused pino log rotation errors for npm users; the build script now copies the file automatically.

## [0.0.3-alpha] - 2026-05-06

### Added / 新增

- 新增每日用量统计：跨会话累计当天请求数、token 消耗、重试与错误数，持久化到 `<logDir>/stats/YYYY-MM-DD.json`，并在启动时自动恢复当天已有数据；退出时 Session Summary 也会展示当天累计值。
- Added daily usage statistics that persist request count, token usage, retries, and errors across sessions to `<logDir>/stats/YYYY-MM-DD.json`, automatically restore the current day on startup, and show the current day's totals in Session Summary on exit.
- CLI 新增 `stats` 子命令，支持查看当天用量、指定日期用量以及历史日期列表。
- Added a `stats` CLI subcommand to inspect today's usage, a specific day's usage, and the list of recorded dates.
- 新增 `STATS_FLUSH_INTERVAL_MS` 环境变量，用于控制每日统计的定时刷盘间隔。
- Added the `STATS_FLUSH_INTERVAL_MS` environment variable to control the periodic flush interval for daily stats.
- 新增独立英文文档 `docs/README.en.md`，便于英文用户直接查阅安装、配置与统计说明。
- Added standalone English documentation at `docs/README.en.md` so English-speaking users can read install, configuration, and stats guidance directly.
- 补充每日统计与跨 chunk SSE 过滤相关单元测试。
- Added unit coverage for daily stats helpers and cross-chunk SSE filtering.

### Changed / 变更

- 日志目录解析在源码仓库开发场景下优先回退到当前工作目录的 `./logs`，让本地调试与 `stats` 查询默认共用同一套日志/统计目录。
- Log directory resolution now prefers `./logs` when running from the source repository, so local development and the `stats` command share the same default logs and stats location.
- SSE 事件过滤器重构为有状态的 `SSEFilter` 类，支持跨 TCP chunk 持续解析 `event:` 行，并统一复用讯飞错误详情提取逻辑改进流式/非流式日志。
- Refactored the SSE event filter into a stateful `SSEFilter` that keeps parsing across TCP chunks, and reused unified iFlytek error extraction to improve both streaming and non-streaming logs.
- 自动重试范围补充讯飞业务错误码 `11210`，日志轮转 transport 切换为内置 `pretty-roll-transport.js` 并增加 `dateFormat` 配置，同时引入 `pino-pretty` 提升开发环境日志可读性。
- Added iFlytek business error code `11210` to the auto-retry scope, switched log rotation to the built-in `pretty-roll-transport.js` with `dateFormat`, and added `pino-pretty` for more readable development logs.
- 启动日志新增当前 `logDir` 输出，请求错误与未命中路由日志改为更易读的单行格式。
- Startup logs now include the resolved `logDir`, and request-error/unmatched-route logs use a more readable one-line format.
- README 改为中文主文档并链接独立英文版，英文文档迁移到 `docs/README.en.md`，发布包文件列表也同步切换为该英文文档路径。
- README is now Chinese-first with a linked standalone English version, English docs moved to `docs/README.en.md`, and the published package now ships that English doc path as well.

### Fixed / 修复

- 修复 SSE 过滤器在 `event:` 行被拆分到多个 TCP chunk 时可能漏过滤 `progress_notice`、`context_usage` 事件的问题。
- Fixed SSE filtering when an `event:` line is split across multiple TCP chunks, which could previously leak `progress_notice` and `context_usage` events.
- 修复对讯飞业务错误码 `10012` 的重试判断：HTTP 4xx 客户端错误不再因为响应体包含该错误码而被误判为可重试。
- Fixed retry classification for iFlytek error code `10012`: HTTP 4xx client errors are no longer retried just because the response body contains that code.
- 增强流式与非流式请求在上游返回空响应体时的兜底错误处理，避免返回不明确的失败结果。
- Improved fallback error handling for both streaming and non-streaming requests when the upstream returns an empty body, avoiding ambiguous failures.
- 修复 ESLint 对 `*.js` 的忽略范围过宽问题，避免误忽略子目录中的 JavaScript 文件。
- Fixed the overly broad ESLint `*.js` ignore rule so JavaScript files in subdirectories are no longer skipped unintentionally.

## [0.0.2-alpha] - 2026-04-30

### Added / 新增

- 支持 npm 全局安装：`npm i -g maas-coding-proxy` 后可直接运行 `maas-coding-proxy start`，无需 Bun。
- Supports npm global install: `npm i -g maas-coding-proxy`, then run `maas-coding-proxy start` directly without Bun.
- 新增 `pnpm release:auto:dry-run <version-or-bump>` 独立脚本，便于直接预演完整本地自动化发布流程。
- Added dedicated `pnpm release:auto:dry-run <version-or-bump>` script for previewing the full local automated release flow.
- 新增 `pnpm release:auto <version-or-bump>`，可把 dry-run、测试、构建、版本升级、tag 创建、校验与可选 push 串成一条本地自动化发布命令。
- Added `pnpm release:auto <version-or-bump>` to automate the local release flow, including dry-run preview, tests, build, version bump, tag creation, verification, and optional push.
- 新增 `pnpm release:dry-run <version-or-bump>`，可只读预览预计版本、tag、changelog 迁移与 release notes 来源。
- Added `pnpm release:dry-run <version-or-bump>` to preview the target version, tag, changelog migration, and release notes source without mutating the repository.
- 新增 `pnpm release:check` 与 `pnpm release:prepare <version>`，用于本地校验 changelog，并在需要时把 `Unreleased` 搬运到新版本标题、随后重建 `Unreleased` 模板，再准备 release commit 与 tag。
- Added `pnpm release:check` and `pnpm release:prepare <version>` for local changelog validation and for promoting `Unreleased` notes into a new version heading, then rebuilding the `Unreleased` template before preparing the release commit and tag.
- CLI 新增 `start` 子命令（默认），保留 `init` / `doctor` 子命令位以备后续扩展。
- Added `start` subcommand (default) to CLI, with placeholder slots for future `init` / `doctor` subcommands.
- CLI 新增 `--log-dir <dir>` 选项，支持指定日志输出目录。
- Added `--log-dir <dir>` CLI option for customizing log output directory.
- CLI 新增 `-c, --config <path>` 选项，支持指定自定义配置文件路径。
- Added `-c, --config <path>` CLI option to specify a custom configuration file.
- 新增配置发现链：按 CLI flags → 环境变量 → `$MAAS_CODING_PROXY_CONFIG` → XDG config 目录 → CWD `.env` 顺序查找，全局安装后可将配置文件放到 `~/.config/maas-coding-proxy/config.env`。
- Added config discovery chain: CLI flags → env vars → `$MAAS_CODING_PROXY_CONFIG` → XDG config dir → CWD `.env`. Global install users can place config at `~/.config/maas-coding-proxy/config.env`.
- 新增 `XFYUN_LOG_DIR` 环境变量支持，全局安装时默认日志写入 `~/.local/state/maas-coding-proxy/logs/`。
- Added `XFYUN_LOG_DIR` env var support; when installed globally, logs default to `~/.local/state/maas-coding-proxy/logs/`.
- 新增 `src/server.ts`，导出 `createServer()` / `startServer()`，便于测试和后续库化集成。
- Added `src/server.ts` exporting `createServer()` / `startServer()` for easier testing and future library-mode integration.

### Changed / 变更

- `bun` 从 `dependencies` 移至 `devDependencies`，npm 全局安装体积从 ~100 MB 降至 ~26 kB。
- Moved `bun` from `dependencies` to `devDependencies`; npm global install size reduced from ~100 MB to ~26 kB.
- `src/config.ts` 重构为函数式 `loadConfig()`，消除模块顶层副作用（不再在 import 时立即执行 CLI 解析和 dotenv 加载）。
- Refactored `src/config.ts` to a functional `loadConfig()`, eliminating module-level side effects (CLI parsing and dotenv loading are no longer triggered on import).
- `src/index.ts` 简化为纯 bin 入口（parseCli → loadConfig → createServer → startServer），服务器逻辑迁移至 `src/server.ts`。
- Simplified `src/index.ts` to a pure bin entry point (parseCli → loadConfig → createServer → startServer); server logic moved to `src/server.ts`.
- 日志路径由硬编码 `./logs/proxy.log` 改为根据 `logDir` 配置动态决定。
- Log path changed from hardcoded `./logs/proxy.log` to dynamically resolved from `logDir` config.
- `package.json` 新增 `publishConfig: { access: "public" }`、`prepack: chmod +x dist/index.js`，`files` 补充 `README.md`。
- Added `publishConfig: { access: "public" }`, `prepack: chmod +x dist/index.js` to `package.json`; added `README.md` to `files`.
- `prepublishOnly` 现在会先校验 `CHANGELOG.md` 是否包含当前版本标题，再执行测试与构建。
- `prepublishOnly` now validates that `CHANGELOG.md` contains the current version heading before running tests and build.

### Added / 新增（保留前次 Unreleased）

- 新增会话统计摘要：退出时（Ctrl+C）输出本次运行的请求数、token 消耗、重试次数、错误数和运行时长。
- Added session summary: prints request count, token usage, retries, errors, and uptime on exit (Ctrl+C).
- 新增讯飞业务错误码 `10010`（Engine Busy）和 `10006`（连接异常断开）到自动重试范围。
- Added iFlytek business error codes `10010` (Engine Busy) and `10006` (abnormal connection closure) to auto-retry scope.
- 日志优化：请求完成时展示 token 消耗（`in=X out=Y total=Z`），≥10k 时缩写为 `12.3k(12345)` 格式。
- Improved request log output: shows token usage (`in=X out=Y total=Z`), abbreviates ≥10k values as `12.3k(12345)`.
- 新增 `GET /v1/*` 代理支持，可透传 `/v1/models` 等 GET 请求到讯飞上游。
- Added `GET /v1/*` proxy support, forwarding GET requests like `/v1/models` to the iFlytek upstream.

### Changed / 变更（保留前次 Unreleased）

- 测试框架由 Vitest 迁移为 Bun 内置测试运行器（`bun:test`），移除 vitest 依赖和配置文件。
- Migrated test framework from Vitest to Bun's built-in test runner (`bun:test`), removing vitest dependency and config file.

## [0.0.1-alpha] - 2026-04-30

### Added / 新增

- 首个 alpha 预览版本：提供将 OpenAI 兼容请求转发到讯飞星辰 Coding Plan API 的本地代理服务。
- Initial alpha preview release: a local proxy that forwards OpenAI-compatible requests to the iFlytek Xingchen Coding Plan API.
- 支持 `/v1/*` 到上游 `/v2/*` 的路径重写。
- Supports rewriting `/v1/*` requests to upstream `/v2/*` endpoints.
- 支持流式 SSE 透传，并过滤 `progress_notice`、`context_usage` 等非标准事件。
- Supports SSE stream passthrough while filtering non-standard events such as `progress_notice` and `context_usage`.
- 支持清理讯飞响应中的 `reasoning_content`、`plugins_content` 字段，以提升 OpenAI 兼容性。
- Cleans `reasoning_content` and `plugins_content` from iFlytek responses for better OpenAI compatibility.
- 支持对 HTTP `429` / `503` 及讯飞业务错误码 `10012` 的指数退避重试。
- Supports exponential backoff retries for HTTP `429` / `503` and iFlytek business error code `10012`.
- 支持通过 `.env`、环境变量和 CLI 参数进行配置。
- Supports configuration via `.env`, environment variables, and CLI options.
- 提供 `GET /health` 健康检查接口。
- Provides a `GET /health` health check endpoint.
- 提供控制台单行日志与本地轮转日志文件输出。
- Provides one-line console logging and local rotating log files.
- 提供测试、Lint、格式化与构建脚本，便于后续开发与发布。
- Provides test, lint, formatting, and build scripts for ongoing development and release workflows.
