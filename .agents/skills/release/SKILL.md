---
name: release
description: 'Use when preparing, validating, or executing xfyun-coding-proxy releases. Trigger whenever the user wants to cut a version, bump semver, run pnpm release:prepare, align CHANGELOG/package.json/git tags, publish to npm, or create a GitHub Release.'
argument-hint: '目标版本、发布类型或发布任务，例如 0.0.2、patch、beta 发布'
user-invocable: true
---

# xfyun-coding-proxy Release

## 这个 skill 做什么

把本项目的发布流程收敛成一条可重复执行的工作流：维护 `CHANGELOG.md` 的 `Unreleased` 内容、本地准备 release commit 与 tag、触发 npm publish，并让 GitHub Release 正文与 changelog 对齐。

如需查看当前仓库的发布入口与相关文件，请先读 [project release files](./references/project-release-files.md)。

如果用户只想做**只读检查**、不希望任何命令改动仓库状态，请改用 `/release-audit`。

## 何时使用

当用户提到以下任一需求时使用：

- “准备发版” / “发一个 npm 版本”
- “帮我 cut release / 发布 prerelease / beta / alpha”
- “帮我跑 `pnpm release:prepare`”
- “检查 changelog、版本号、tag 是否对齐，然后继续发布”
- “触发 GitHub Release / npm publish 自动化”

## 核心约束

- 不要依赖本地手动 `npm publish` 来生成 GitHub Release；本项目的自动 release 依赖推送 tag 后的 GitHub Actions。
- `CHANGELOG.md` 是 GitHub Release 正文的唯一来源。
- `/release` 在执行任何会改动仓库状态的发布动作前，应先运行 `pnpm release:dry-run <version-or-bump>` 并向用户展示预演摘要。
- 如果希望把 dry-run、测试、构建、`release:prepare`、changelog 校验与可选 push 串成一条命令，可使用 `pnpm release:auto <version-or-bump> [--dry-run] [--push] [--yes]`。
- `pnpm release:prepare <version>` 会在目标标题不存在时，把 `## [Unreleased]` 内容提升为新版本章节，并把 `## [Unreleased]` 重建为固定模板。
- 只有模板、没有真实条目的 `Unreleased` 视为“空”，必须阻止发版。

## 标准流程

1. **确认发布目标**
   - 判断是显式版本（如 `0.0.2`、`0.0.2-beta.1`）还是 npm 语义升级参数（如 `patch`、`minor`、`prerelease`）。
   - 如果需要 GitHub prerelease，最终版本必须包含 `-`（如 `-beta.1`、`-alpha`、`-rc.0`）。

2. **维护 changelog**
   - 优先把发布说明写在 `CHANGELOG.md` 的 `## [Unreleased]` 下。
   - 确保存在真实条目，而不是只有 `Added / Changed / Fixed` 模板标题。
   - 如果 `Unreleased` 只有模板标题、没有真实条目，先执行 `/changelog-generator` 从 git 历史自动生成 changelog 条目，然后再继续发布流程。
   - 如果用户已经手工写好了目标版本标题，也允许直接复用。

3. **先做 dry-run 预演**
   - 运行 `pnpm release:dry-run <version-or-bump>`，或使用 `pnpm release:auto <version-or-bump> --dry-run` 预演完整本地自动化流程。
    - 向用户汇总：
       - 当前版本 / 目标版本 / 预计 tag；
       - changelog 来源（复用已有版本标题 / 从 `Unreleased` 提升 / 被阻塞）；
       - release notes 预览；
       - blockers 与下一步建议。
    - 如果 dry-run 已经暴露 blocker，必须先停下，不要继续执行 `release:prepare`。

4. **同步 README 版本号**
   - 在执行 `release:prepare` **之前**，先将 `README.md` 中的 `当前版本` 和 `docs/README.en.md` 中的 `Current version` 更新为目标版本号。
   - 这样 README 的变更会被包含在 `release:prepare` 创建的 release commit 和 tag 中，无需后续 amend。

5. **执行本地准备**
     - 可选两条路径：
        - 手动分步：运行 `pnpm release:prepare <version-or-bump>`；
        - 一条命令自动化：运行 `pnpm release:auto <version-or-bump> [--push] [--yes]`。
     - 预期行为：
       - 更新 `package.json` 版本号；
       - 必要时把 `Unreleased` 提升为 `## [version] - YYYY-MM-DD`；
       - 重建 `## [Unreleased]` 模板；
       - 创建本地 commit：`chore: release vX.Y.Z`；
       - 创建本地 annotated tag：`vX.Y.Z`。
         - `release:auto` 还会在变更前自动运行 `pnpm test` 与 `pnpm build`，并在准备完成后执行 `pnpm release:check` 与 `git diff --check`；加上 `--push` 时会继续执行 `git push` 和 `git push --tags`。
     - 注意：`release:prepare` 脚本本身只提交 `package.json` 和 `CHANGELOG.md`，不会自动包含 README 变更。因此必须先更新 README 并 `git add`，再执行 `release:prepare`，确保 README 变更进入同一个 release commit。

6. **复核本地产物**
   - 检查 `package.json` 的 `version`。
   - 检查 `CHANGELOG.md` 是否同时满足：
     - 目标版本章节存在；
     - `Unreleased` 已恢复为模板；
     - 发布说明没有丢失或串到别的版本。
   - 检查 `README.md` 和 `docs/README.en.md` 中的版本号是否与 `package.json` 一致。
   - 检查 git 状态，确认 release commit 和 tag 已创建，且无意外改动。

7. **执行发布前校验**
   - 运行：
     - `pnpm release:check`
     - `pnpm test`
     - `pnpm build`
     - `git diff --check`
   - **敏感信息检查**：扫描 `package.json` `files` 字段包含的所有文件（`dist/`、`.env.example`、`README.md`、`CHANGELOG.md`、`docs/README.en.md`）以及 `src/` 源码，确认不存在真实密钥、token 或其他敏感信息泄露。检查项包括：
     - 硬编码的 API Key（如 `sk-` 开头的真实密钥、`eyJ` 开头的 JWT）
     - 私钥（`-----BEGIN PRIVATE KEY`）
     - `.env` 文件误入 `files` 字段
     - `dist/` 中是否意外包含了源码或配置文件
   - 只有全部通过，才可以继续推送。

8. **推送并触发远端发布**
   - 运行：
     - `git push`
     - `git push --tags`
   - GitHub Actions 会根据 `v*` tag 自动：
     - 校验 tag 与 `package.json` 版本一致；
     - 从 `CHANGELOG.md` 提取对应版本正文；
     - 执行 npm publish；
     - 创建 GitHub Release。

9. **发布后确认**
   - 检查 GitHub Actions `publish.yml` 成功。
   - 检查 npm 上新版本已可见。
   - 检查 GitHub Release：
     - 标题与 tag 一致；
     - 正文来自对应 changelog 章节；
     - prerelease 标记是否符合预期。

## 分支判断

- **目标版本标题已存在**：直接复用现有章节，不必再次从 `Unreleased` 搬运。
- **`Unreleased` 只有模板**：必须停止并让用户先补真实发布说明。
- **目标 tag 已存在**：必须停止，避免覆盖既有 release。
- **仓库中有无关改动**：提醒用户 review；当前脚本只提交 `package.json` 和 `CHANGELOG.md`，不会顺手把别的改动打进 release commit。

## 完成标准

只有满足以下条件，才算这次发布准备或发布工作完成：

- `package.json.version`、git tag、GitHub Release tag 三者一致；
- `CHANGELOG.md` 中存在对应版本章节；
- `pnpm release:check`、`pnpm test`、`pnpm build`、`git diff --check` 全部通过；
- GitHub Actions 发布工作流成功；
- npm 包与 GitHub Release 都已生成且内容正确。

## 可直接触发这个 skill 的示例

- `/release 准备发布 0.0.2`
- `/release 帮我发布一个 0.0.2-beta.1`
- `/release 用 patch 规则准备一次本地 release`
- `/release 看看 changelog、tag 和 npm 发布链路是否对齐后直接继续`
- `/release 用 pnpm release:auto patch --dry-run 先帮我预演一遍`
