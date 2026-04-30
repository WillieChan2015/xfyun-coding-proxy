---
name: release-audit
description: 'Use when auditing, reviewing, or dry-running xfyun-coding-proxy release readiness without mutating repository state. Trigger whenever the user wants a preflight checklist, changelog/version/tag alignment review, or asks what is missing before release.'
argument-hint: '审计目标或关注点，例如 0.0.2、beta 发布检查、发版前还差什么'
user-invocable: true
---

# xfyun-coding-proxy Release Audit

## 这个 skill 做什么

提供一个**只读**的发布审计流程：检查当前版本、`CHANGELOG.md`、git 状态、tag、GitHub Actions 发布链路是否对齐，并输出“可发布 / 有阻塞 / 建议下一步”的结论。

如果用户确认要继续执行发版动作，请切换到 `/release`。

如需查看审计清单和允许使用的命令，请先读 [release readiness checklist](./references/release-readiness-checklist.md)。

## 何时使用

当用户提到以下任一需求时使用：

- “发版前帮我检查一下”
- “先做个 dry-run / preflight / audit”
- “看看 changelog、版本号、tag 对不对”
- “现在离发布还差什么”
- “只读检查，不要改仓库”

## 只读边界

这个 skill **默认禁止**执行任何会修改仓库或远端状态的动作，包括但不限于：

- `pnpm release:prepare`
- `npm publish` / `pnpm publish`
- `git commit`
- `git tag`
- `git push`
- `pnpm build`（因为会写入 `dist/`，不属于严格只读）

允许的动作应限制在：读取文件、查看 git 状态 / tag / 历史、执行不写文件的校验命令。

## 审计流程

1. **确认审计范围**
   - 判断用户是要检查当前工作树、特定目标版本，还是某次 prerelease 计划。
   - 如果用户给了目标版本，显式对照该版本检查 changelog 和 tag；否则以当前 `package.json.version` 为准。

2. **读取关键文件**
   - 查看：
     - `package.json`
     - `CHANGELOG.md`
     - `.github/workflows/publish.yml`
     - `.github/scripts/verify-changelog-version.mjs`
     - `.github/scripts/prepare-release.mjs`
   - 重点关注：
     - 当前版本号；
     - `Unreleased` 是否有真实条目；
     - 目标版本章节是否已存在；
     - 发布工作流是否仍按 `v*` tag 触发。

3. **执行只读校验**
   - 可以运行：
     - `pnpm release:check`
     - `pnpm test`
     - `git diff --check`
     - `git status --short`
     - `git tag --list`
   - 不要运行会写出构建产物或创建 tag/commit 的命令。

4. **识别阻塞项**
   - 常见阻塞包括：
     - `CHANGELOG.md` 中缺少当前版本章节；
     - `Unreleased` 只有模板，没有真实内容；
     - git 工作区存在与发布无关的脏改动；
     - 预期目标 tag 已存在；
     - 工作流配置与本地发布脚本不一致。

5. **输出审计结论**
   - 用清晰的矩阵或清单给出：
     - 已通过项；
     - 阻塞项；
     - 建议下一步。
   - 如果一切就绪，再明确告诉用户：
     - 现在可以切换到 `/release` 执行真正的发布准备。

## 推荐输出结构

- **当前版本 / 目标版本**
- **CHANGELOG 状态**
- **git 状态与 tag 状态**
- **已运行的只读校验及结果**
- **阻塞项 / 风险项**
- **建议下一步**

## 完成标准

只有在以下信息都已明确后，才算审计完成：

- 当前或目标版本号已确认；
- changelog / version / tag 的对应关系已检查；
- 只读校验结果已给出；
- 已明确哪些问题阻止发版，或确认“可切换到 `/release`”。

## 可直接触发这个 skill 的示例

- `/release-audit 现在发 0.0.2 前还差什么`
- `/release-audit 帮我只读检查一下当前 changelog、version、tag 是否一致`
- `/release-audit 做一次 beta 发布前的 dry-run，不要改仓库`
- `/release-audit 看看现在能不能安全切到 /release`
