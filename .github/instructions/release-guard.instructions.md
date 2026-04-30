---
description: "Use when working on xfyun-coding-proxy release, publish, tag, or push tasks. Prefer /release-audit for read-only checks, /release-dry-run for previews, and /release for real execution. Never treat local npm publish as equivalent to the tag-driven GitHub Release workflow."
name: "Release Guard"
---
# Release Guard

- 对于只读检查，优先使用 `/release-audit`；对于结果预演，优先使用 `/release-dry-run`；只有在用户明确要求执行真实发布准备时才使用 `/release`。
- 使用 `/release` 时，先运行与目标版本对应的 `pnpm release:dry-run <version-or-bump>`，先给出预演摘要；只有在用户明确要求继续后，才执行 `pnpm release:prepare`、`git push`、`git push --tags` 这类会改动状态的命令。
- 如果用户选择本地自动化入口 `pnpm release:auto <version-or-bump>`，也要遵守相同原则：优先 `--dry-run`，真实执行前确认用户接受测试、版本升级、tag 创建和可选 push。
- 不要把本地 `npm publish` / `pnpm publish` 当成生成 GitHub Release 的路径；本仓库的正式发布链路依赖 `v*` tag 触发的 GitHub Actions。
- 在尝试执行 `pnpm release:prepare`、`git tag`、`git push`、`git push --tags` 之前，必须确认用户已经明确要求继续执行会改动仓库或远端状态的动作。
- 如果 `CHANGELOG.md` 的 `Unreleased` 只有模板、没有真实条目，必须先指出阻塞，再建议用户补充发布说明。
