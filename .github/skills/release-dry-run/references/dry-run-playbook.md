# Release Dry Run Playbook

`release-dry-run` 的目标是预览真实发布前会发生什么，但不允许改动仓库状态。

## 重点文件

- `.github/scripts/release-dry-run.mjs`
  - 真实的 dry-run 预览脚本。
  - `pnpm release:dry-run <version-or-bump>` 会输出目标版本、预计 tag、changelog 迁移预览、release notes 来源和阻塞项。

- `package.json`
  - 当前版本号来源。

- `CHANGELOG.md`
  - 用于判断：
    - 目标版本标题是否已存在；
    - `Unreleased` 是否有真实条目；
    - GitHub Release 正文最终会来自哪里。

- `.github/scripts/prepare-release.mjs`
  - 描述真实执行时会如何提升 `Unreleased`、重建模板、创建 commit 和 tag。

- `.github/scripts/extract-release-notes.mjs`
  - 描述 GitHub Release 如何提取对应版本正文。

- `.github/workflows/publish.yml`
  - 描述 tag 推送后远端发布链路如何完成 npm publish 与 GitHub Release。

## dry-run 必须回答的问题

1. 当前版本号是什么？
2. 目标版本号 / 目标 tag 是什么？
3. 目标版本标题是否已存在？
4. 如果不存在，`Unreleased` 是否有真实内容可提升？
5. 提升后预计的 GitHub Release 正文来源是什么？
6. 发版后 `Unreleased` 会恢复成什么模板？
7. 现在还缺什么，或者下一步可以直接执行什么？

## 严格禁止的动作

- `pnpm release:prepare`
- `git commit`
- `git tag`
- `git push`
- `npm publish` / `pnpm publish`
- `pnpm build`

## 建议输出

- 目标版本 / 预计 tag
- changelog 迁移预览
- release notes 来源
- 阻塞项
- 下一步建议（通常是切换到 `/release`）

## 推荐命令

- `pnpm release:dry-run 0.0.2`
- `pnpm release:dry-run 0.0.2-beta.1`
- `pnpm release:dry-run patch`
