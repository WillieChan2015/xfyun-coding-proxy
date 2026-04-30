# Changelog / 更新日志

本文档记录本项目的显著版本变更。

This document records notable changes to this project.

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
