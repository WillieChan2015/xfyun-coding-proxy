# xfyun-coding-proxy

## 协作约定

- 仓库说明默认使用中文；如有需要可补充英文说明。
- 修改以最小、可验证为原则，避免无关重构。
- 如文档与实现不一致，优先以 `package.json`、`src/` 当前代码和测试为准，再回补文档。
- 新增说明时优先链接已有文档，不要把长篇设计、计划或分析内容重复复制到新文件里。
- 个人分析、设计、计划等本地 AI 辅助资料统一放在 `.github/docs/`，默认不纳入版本控制，也不应成为公开协作前提。
- 项目专属 skills 已迁移至 `.agents/skills/`（含 `changelog-generator`、`release`、`release-dry-run`、`release-audit`）。
- 个人 AI 分析、设计、计划等本地资料统一放在 `.github/docs/`，默认不纳入版本控制。

## 项目定位

- 这是一个本地 Fastify 代理：将 OpenAI 兼容请求转发到讯飞星辰 Coding Plan API。
- 从源码仓库开发 / 调试时需要 Bun；`pnpm start` / `pnpm dev` 会直接调用 Bun 运行 TypeScript。
- 发布态与编译产物运行面向 Node.js `>=20`；`pnpm build` 输出的 `dist/` 默认由 Node 执行。
- 当前关键路由是 `POST /v1/*`（代理）和 `GET /health`（健康检查）。
- 服务默认监听 `127.0.0.1`；除非需求明确，不要随意放宽监听地址。

## 关键文件

- `src/index.ts`：Fastify 启动、日志、错误响应、优雅关停。
- `src/proxy.ts`：请求转发、SSE 过滤、重试、讯飞字段清理，是最核心的行为文件。
- `src/config.ts`：`.env`、环境变量、CLI 参数合并与校验。
- `src/cli.ts`：命令行参数定义。
- `src/util.ts`：token 用量提取与格式化。
- `test/unit/*.test.ts`：纯函数与边界条件测试。
- `logs/`：运行产物目录，不是源码修改目标。

## 常用命令

- `pnpm dev`：热重载开发（源码运行，需要 Bun）。
- `pnpm start`：启动本地代理（源码运行，需要 Bun）。
- `pnpm test`：运行测试（使用 Bun 自带 test 模块，禁止引入第三方测试框架如 Vitest、Jest）。
- `pnpm test:coverage`：查看覆盖率。
- `pnpm lint`：运行 ESLint。
- `pnpm build`：编译到 `dist/`（产物面向 Node.js `>=20`）。

## 改动守则

- 修改 `src/proxy.ts` 时，优先保护这些行为不回归：
  1. `/v1/*` 到上游 `/v2/*` 的路径重写；
  2. `progress_notice`、`context_usage` 的 SSE 过滤；
  3. HTTP `429` / `503` 与讯飞业务错误码 `10012` 的重试语义；
  4. 对 OpenAI 兼容响应清理 `reasoning_content`、`plugins_content`。
- 修改 `src/index.ts` 时，不要破坏：
  - `Authorization` 日志脱敏；
  - OpenAI 风格错误响应结构；
  - `SIGINT` / `SIGTERM` 优雅关停；
  - `127.0.0.1` 监听与 `/health` 路由。
- 修改配置或新增环境变量时，同步更新 `src/config.ts`、`src/cli.ts`、`.env.example` 与 README 中的配置说明。
- 涉及用户可见行为、启动方式或配置项时，同步更新 `README.md` 和 `docs/README.en.md`。
- 纯文档改动通常无需跑全量校验；代码改动至少运行受影响测试，常见验证顺序是 `pnpm test`，必要时补 `pnpm lint` 与 `pnpm build`。

## 优先参考公开文档

- 快速使用：[`README.md`](./README.md)、[`docs/README.en.md`](./docs/README.en.md)
