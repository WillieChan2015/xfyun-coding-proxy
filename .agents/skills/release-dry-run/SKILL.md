---
name: release-dry-run
description: 'Use when previewing or simulating an xfyun-coding-proxy release without mutating repository state. Trigger whenever the user wants a dry run of pnpm release:prepare, a preview of the next tag and changelog section, or asks what would happen if they released a version.'
argument-hint: '目标版本、预发布版本或 dry-run 任务，例如 0.0.2、0.0.2-beta.1、patch dry-run'
user-invocable: true
---

# xfyun-coding-proxy Release Dry Run

## 这个 skill 做什么

提供一个**不改仓库状态**的发布预演流程：预估下一次 release 的版本号、tag、changelog 迁移结果、GitHub Release 正文来源，以及真正执行前还会遇到哪些阻塞项。

如果用户只想要 readiness checklist 而不需要预览结果，请改用 `/release-audit`。
如果用户确认要继续执行真实发布准备，请切换到 `/release`。

如需查看预演时应参考的文件与输出结构，请先读 [dry run playbook](./references/dry-run-playbook.md)。

仓库已经内置可直接运行的预览命令：`pnpm release:dry-run <version-or-bump>`。

## 何时使用

当用户提到以下任一需求时使用：

- “先 dry-run 看看会发什么”
- “预览一下 `pnpm release:prepare` 会做什么”
- “如果发 0.0.2 / beta，会生成什么 tag 和 changelog”
- “不要改仓库，先看这次 release 正文和步骤”

## 不变更仓库的边界

这个 skill 默认禁止执行任何会改变工作树或远端状态的动作，包括但不限于：

- `pnpm release:prepare`
- `git commit`
- `git tag`
- `git push`
- `npm publish` / `pnpm publish`
- `pnpm build`

允许的动作应限制在：读取文件、只读命令、以及基于现有脚本逻辑做预估。

## 预演流程

1. **确认目标版本**
   - 如果用户给的是显式版本（如 `0.0.2`、`0.0.2-beta.1`），直接围绕该版本预演。
   - 如果用户给的是语义升级参数（如 `patch`、`minor`、`prerelease`），先说明这是一个“版本 bump 规则”，再结合当前 `package.json.version` 推导可能的目标版本；如果无法安全推导，就明确说明需要用户确认目标版本。

2. **读取关键输入**
   - 查看：
     - `package.json`
     - `CHANGELOG.md`
     - `.github/scripts/prepare-release.mjs`
     - `.github/scripts/extract-release-notes.mjs`
     - `.github/workflows/publish.yml`
   - 重点判断：
     - 当前版本号；
     - `Unreleased` 是否有真实条目；
     - 目标版本标题是否已经存在；
     - 目标 tag 是否会被当作 prerelease。

3. **预估本地 release 准备会发生什么**
   - 优先运行 `pnpm release:dry-run <version-or-bump>` 获取结构化预览结果。
   - 如果目标版本标题已存在：说明 `release:prepare` 会直接复用该章节。
   - 如果目标版本标题不存在且 `Unreleased` 有真实条目：说明 `release:prepare` 会把 `Unreleased` 提升为 `## [version] - YYYY-MM-DD`，然后把 `Unreleased` 重建为标准模板。
   - 如果 `Unreleased` 只有模板：先提示用户执行 `/changelog-generator` 补充 changelog 条目，然后再重新 dry-run；明确指出当前 dry-run 在这里会阻塞，真实执行也会失败。

4. **预览 release 输出**
   - 给出：
     - 目标版本号；
     - 预计 tag（`vX.Y.Z`）；
     - 预计 release commit 信息（`chore: release vX.Y.Z`）；
     - 预计 GitHub Release 正文来源（已有版本章节或由 `Unreleased` 提升后的正文）；
     - 发版后 `Unreleased` 会变成什么模板。

5. **给出下一步建议**
   - 如果 dry-run 结果可行：提示可切换到 `/release` 执行真实发布准备。
   - 如果存在阻塞：清楚列出问题和修复建议。

## 推荐输出结构

- **目标版本 / 预计 tag**
- **当前 changelog 状态**
- **`release:prepare` 预计动作**
- **GitHub Release 正文预览来源**
- **阻塞项 / 风险项**
- **如果确认执行，下一步命令**

## 完成标准

只有在以下信息都已经明确后，才算 dry-run 完成：

- 已明确目标版本或明确说明仍需用户确认；
- 已说明 `release:prepare` 会复用现有版本章节还是从 `Unreleased` 提升；
- 已给出预计 tag / commit / release notes 来源；
- 已给出阻塞项或明确“现在可切换到 `/release`”。

## 可直接触发这个 skill 的示例

- `/release-dry-run dry-run 一次 0.0.2 发布`
- `/release-dry-run 预览一下如果我发 0.0.2-beta.1 会发生什么`
- `/release-dry-run 不改仓库，看看这次 release:prepare 会生成什么`
- `/release-dry-run 帮我模拟下一次 patch 发布`
- `/release-dry-run 然后顺手运行 pnpm release:dry-run 0.0.2 给我看结果`
