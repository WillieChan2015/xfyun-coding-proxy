# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

xfyun-coding-proxy（maas-coding-proxy）是一个本地代理服务器，将讯飞星火编程 API 适配为多种标准协议，让 Cursor、Claude Code、VS Code Continue.dev 等 IDE 直接使用讯飞模型。

## Commands

```bash
pnpm build          # 编译 TypeScript → dist/
pnpm dev            # 开发模式运行代理
pnpm test           # 运行所有测试
pnpm test:unit      # 仅运行单元测试
pnpm lint           # ESLint 检查
pnpm lint:fix       # ESLint 自动修复
pnpm release:prepare # 版本准备（bump + changelog + tag）
```

运行单个测试：`npx vitest run test/unit/stats.test.ts`

## Architecture

```
src/
├── cli.ts              # CLI 入口（stats/setup/start 命令）
├── server.ts           # HTTP 服务器启动、信号处理、定时刷盘、Ink 监控集成
├── config.ts           # 环境变量配置加载
├── proxy.ts            # OpenAI 协议 handler（/v1/*）
├── upstream.ts         # 上游请求核心：转发、流式、重试、SSE 过滤
├── errors.ts           # 统一错误处理与响应格式化
├── stats.ts            # 统计数据模型、持久化、事件发射、并发/延迟追踪
├── stats-cmd.ts        # CLI stats 子命令逻辑
├── util.ts             # 工具函数（token 提取、格式化）
├── monitor/            # Ink 实时监控面板
│   ├── entry.ts        # 监控入口（startMonitor），接收 stats 依赖注入
│   ├── app.tsx         # MonitorApp 主组件
│   ├── header.tsx      # 顶部状态栏
│   ├── token-panel.tsx # Token 用量面板
│   ├── request-panel.tsx # 请求状态面板
│   ├── log-stream.tsx  # 请求日志流
│   └── footer.tsx      # 底部快捷键提示
├── anthropic/
│   └── handler.ts      # Anthropic 协议 handler（/anthropic/v1/messages）
└── ollama/
    └── handler.ts      # Ollama 协议 handler（/ollama/api/*）
```

**请求流转**：IDE → server.ts 路由分发 → 对应协议 handler → 转换请求格式 → 调用讯飞 API → 转换响应格式 → 返回 IDE

**统计系统**：双层结构——sessionStats（内存，进程退出时丢弃）+ dailyStats（持久化到 `logs/stats/YYYY-MM-DD.json`，60s 定时刷盘）。三个 handler 通过 `recordRequestComplete()` 集中更新统计 + 发射事件。Ink 监控面板订阅 `statsEmitter` 事件实时刷新。

## Conventions

- 遵循 `AGENTS.md` 中的协作约定与改动守则；遵循 `.github/copilot-instructions.md`（若存在）中的本地 AI 辅助规则。三者冲突时以 CLAUDE.md > AGENTS.md > copilot-instructions.md 为优先级。
- 需求文档放在 `.github/docs/`，命名格式 `xxx-requirements.md`；文档索引与目录结构以 `.github/docs/README.md`（若存在）为准，新增或移动文档后同步更新该索引
- 变更日志遵循 Keep-a-Changelog 格式，手动维护 `CHANGELOG.md`
- 版本号在 `package.json` 和 `CHANGELOG.md` 中保持一致
- Git 提交信息格式：`type: description`（feat/fix/chore/docs/refactor）
- 发布标签格式：`v{version}`（如 `v0.0.5-beta.3`）
- 环境变量配置优先于默认值，见 `config.ts` 和 `.env.example`
- 默认使用中文回复，思考过程也用中文；只有在用户明确要求时才切换语言。
- 遵循最小改动原则：只修改与当前任务直接相关的代码，不顺手重构无关区域。
- 对新增导出、兼容逻辑、边界条件补充简洁注释，重点解释“为什么这样做”。
