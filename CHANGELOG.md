# Changelog / 更新日志

本文档记录本项目的显著版本变更。

This document records notable changes to this project.

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added / 新增

- 新增会话统计摘要：退出时（Ctrl+C）输出本次运行的请求数、token 消耗、重试次数、错误数和运行时长。
- Added session summary: prints request count, token usage, retries, errors, and uptime on exit (Ctrl+C).
- 新增讯飞业务错误码 `10010`（Engine Busy）和 `10006`（连接异常断开）到自动重试范围。
- Added iFlytek business error codes `10010` (Engine Busy) and `10006` (abnormal connection closure) to auto-retry scope.
- 日志优化：请求完成时展示 token 消耗（`in=X out=Y total=Z`），≥10k 时缩写为 `12.3k(12345)` 格式。
- Improved request log output: shows token usage (`in=X out=Y total=Z`), abbreviates ≥10k values as `12.3k(12345)`.
- 新增 `GET /v1/*` 代理支持，可透传 `/v1/models` 等 GET 请求到讯飞上游。
- Added `GET /v1/*` proxy support, forwarding GET requests like `/v1/models` to the iFlytek upstream.

### Changed / 变更

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
