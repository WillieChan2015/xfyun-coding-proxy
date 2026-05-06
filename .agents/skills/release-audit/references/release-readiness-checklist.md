# Release Readiness Checklist

这是 `release-audit` skill 使用的只读审计清单。

## 关键文件

- `package.json`
- `CHANGELOG.md`
- `.github/workflows/publish.yml`
- `.github/scripts/verify-changelog-version.mjs`
- `.github/scripts/prepare-release.mjs`

## 允许的只读命令

- `pnpm release:check`
- `pnpm test`
- `git diff --check`
- `git status --short`
- `git tag --list`
- `git log --oneline -n 5`

## 不允许的变更命令

- `pnpm release:prepare`
- `pnpm build`
- `npm publish` / `pnpm publish`
- `git commit`
- `git tag`
- `git push`

## 审计时重点检查

1. `package.json.version` 是否明确。
2. `CHANGELOG.md` 是否满足以下至少一项：
   - 已有目标版本标题；
   - `## [Unreleased]` 下存在真实条目，可供 `release:prepare` 提升。
3. `## [Unreleased]` 是否只是模板骨架；如果只是模板，应判定为阻塞。
4. 当前 git 工作树是否存在无关脏改动。
5. 目标 tag 是否已经存在。
6. `publish.yml` 是否仍然按 `v*` tag 触发，并从 `CHANGELOG.md` 提取 release notes。

## 审计结论建议

输出时尽量分成三类：

- **已通过**：当前满足的项
- **阻塞项**：必须处理后才能继续
- **下一步**：如果要真正发布，建议切换到 `/release`
