# Project Release Files

本仓库发布流程涉及的关键文件如下：

- `CHANGELOG.md`
  - GitHub Release 正文来源。
  - `## [Unreleased]` 是日常维护入口；`release:prepare` 会在需要时提升为新版本章节，并在发版后重建模板。

- `package.json`
  - `version` 是本地 release、git tag、GitHub Release 的基准版本号。
  - `scripts.release:check`、`scripts.release:dry-run`、`scripts.release:prepare` 与 `scripts.release:auto` 是本地发布入口。
  - `prepublishOnly` 会先跑 changelog 校验，再跑测试与构建。

- `.github/scripts/release-dry-run.mjs`
  - 只读预演脚本：解析目标版本 / bump，预估 tag、changelog 迁移结果、release notes 来源与阻塞项。

- `.github/scripts/release-auto.mjs`
  - 本地自动化发布总控脚本：串起 dry-run 预演、版本确认、测试、构建、`release:prepare`、`release:check`、`git diff --check` 与可选 push。

- `.github/scripts/verify-changelog-version.mjs`
  - 校验当前 `package.json.version` 在 `CHANGELOG.md` 中有对应标题。

- `.github/scripts/prepare-release.mjs`
  - 本地 release 准备脚本：升级版本、同步 README 版本号、必要时从 `Unreleased` 生成版本章节、重建模板、创建 commit 与 tag。

- `.github/scripts/extract-release-notes.mjs`
  - 从 `CHANGELOG.md` 中提取某个 tag 对应的发布说明。

- `.github/workflows/publish.yml`
  - 监听 `v*` tag。
  - 发布到 npm。
  - 用 changelog 对应章节创建 GitHub Release。

## 常用命令

- `pnpm release:check`
- `pnpm release:auto <version-or-bump> --dry-run`
- `pnpm release:auto <version-or-bump> --yes`
- `pnpm release:auto <version-or-bump> --push --yes`
- `pnpm release:dry-run <version-or-bump>`
- `pnpm release:prepare <version-or-bump>`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `git push`
- `git push --tags`

## 关键事实

- 带 `-` 的版本 tag（例如 `v0.0.2-beta.1`）会被 GitHub Actions 标记为 prerelease。
- `release:prepare` 不会自动 push。
- `release:prepare` 会自动同步 `README.md` 和 `docs/README.en.md` 中的版本号，并将变更包含在 release commit 中。
- 只有模板、没有真实条目的 `Unreleased` 会阻止本地 release 准备继续执行。
