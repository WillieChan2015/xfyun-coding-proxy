---
name: changelog-generator
description: >
  Project-level skill for xfyun-coding-proxy: Analyze git commits between the latest tag and HEAD,
  then generate or update a Keep-a-Changelog formatted CHANGELOG.md.
  Use this skill whenever the user asks to "generate a changelog", "update the changelog",
  "what changed since last release", "整理 changelog", "更新更新日志", "从 tag 到 HEAD 的变更",
  "写 changelog", or any request about summarizing git history into release notes or changelog entries
  within the xfyun-coding-proxy project. Also trigger when the user mentions version bumps, release preparation,
  or preparing a new version — the changelog is a key part of that workflow.
  Even if the user just says "what changed" or "summarize recent changes" in this project's git repo context,
  this skill should activate.
  Note: This is a project-specific skill located at `.agents/skills/changelog-generator/` — it will only
  trigger when working within the xfyun-coding-proxy project.
---

# Changelog Generator

Generate structured changelog entries from git history, following the [Keep a Changelog](https://keepachangelog.com/) format.

## Why this skill exists

Writing changelogs by hand is tedious and error-prone. Git already contains all the information — commit messages, diffs, file changes — but extracting a human-readable summary requires understanding both the *what* and the *why*. This skill automates that extraction while preserving the nuance that makes a changelog useful.

## Workflow

### Step 1: Identify the range

Find the latest tag and determine the commit range to analyze.

```bash
# Find the latest tag (sorted by creation date, not version order)
git tag --sort=-creatordate | head -5

# List commits in range
git log <latest-tag>..HEAD --oneline --no-decorate

# Get full commit messages (subject + body)
git log <latest-tag>..HEAD --format='--- %s ---%n%b'
```

If there are no tags, analyze all commits from the root (`git log --oneline`).

### Step 2: Gather change details

Get both the high-level overview and the specifics. The overview tells you scope; the specifics tell you substance.

```bash
# File-level change summary (scope), excluding README and package.json
git diff <latest-tag>..HEAD --stat -- ':!README.md' ':!docs/README.en.md' ':!package.json'

# Detailed diffs for key source files (substance)
git diff <latest-tag>..HEAD -- src/

# Test file changes (helps understand what behavior was added/fixed)
git diff <latest-tag>..HEAD -- test/
```

**Ignored files:** Changes to `README.md`, `docs/README.en.md`, and `package.json` are excluded from changelog analysis. These files are documentation/metadata that reflect changes already captured elsewhere — they are not user-visible features themselves. Version bumps, keyword additions, badge updates, and README rewrites should never appear as changelog entries.

Read the actual diffs for source files — commit messages alone often miss important details or describe changes at the wrong level of abstraction. The diff shows what actually happened.

### Step 3: Classify changes

Group changes into the standard Keep a Changelog categories:

| Category | What goes here |
|---|---|
| **Added** | New features, new files, new CLI options, new env vars, new capabilities |
| **Changed** | Modified behavior, refactors, dependency updates, renamed/moved files |
| **Deprecated** | Features slated for removal (rare in practice) |
| **Removed** | Deleted features, dropped dependencies |
| **Fixed** | Bug fixes, error handling improvements, edge case corrections |
| **Security** | Vulnerability fixes (rare in practice) |

**Classification heuristics:**

- A commit message starting with `feat` or `add` → likely **Added**
- A commit message starting with `fix` → likely **Fixed**
- A commit message starting with `refactor` or `change` → likely **Changed**
- A new file in `src/` → **Added** (the capability it provides)
- A new test file → don't list separately; it validates a change already listed
- A renamed file (e.g., `README.zh-CN.md` → `README.en.md`) → **Changed**
- A new dependency in `package.json` → **Changed** (unless it enables a whole new feature, then **Added**)
- A new env var or CLI option → **Added**

**Important:** Don't just parrot commit messages. A single commit like `feat(stats): 添加每日统计功能及 CLI 查询支持` may contain multiple distinct changes (the stats persistence, the CLI command, the env var, the session summary update). Decompose and list each as its own entry.

### Step 4: Write bilingual entries

Write each changelog entry in both Chinese and English, as two consecutive bullet points. The Chinese entry comes first, then the English one.

**Format:**

```markdown
- 中文描述。
- English description.
```

**Writing guidelines:**

- Start with a verb: 新增/Added, 修改/Changed, 修复/Fixed, 移除/Removed
- Describe the *user-visible* change, not the implementation detail
  - Good: "新增 `stats` 子命令，支持查询历史用量" / "Added `stats` subcommand to query historical usage"
  - Bad: "新增 `src/stats-cmd.ts` 文件" / "Added `src/stats-cmd.ts` file"
- For technical changes that affect developers: mention the file or module name
  - "SSE 过滤器重构为有状态的 `SSEFilter` 类" / "Refactored SSE filter into a stateful `SSEFilter` class"
- Keep entries concise — one line per language, no multi-paragraph explanations
- If the change is internal/refactor with no user-visible impact, still include it under **Changed** but describe what was refactored and why

### Step 5: Write to CHANGELOG.md

Locate the project's `CHANGELOG.md`. Find the `## [Unreleased]` section. Replace the empty category headers with the populated ones.

**Target structure:**

```markdown
## [Unreleased]

### Added / 新增

- 中文描述。
- English description.
- 另一条中文描述。
- Another English description.

### Changed / 变更

- 中文描述。
- English description.

### Fixed / 修复

- 中文描述。
- English description.

### Deprecated / 废弃

### Removed / 移除

### Security / 安全
```

**Rules:**

- If a category has no entries, leave the header but omit the empty bullet points (or leave the section completely empty — match the existing style in the file)
- Preserve all existing content below the `[Unreleased]` section unchanged
- If the file uses a different category naming convention (e.g., only English, or only Chinese), follow the existing convention instead of the bilingual format
- If the file doesn't have an `[Unreleased]` section, create one at the top

### Step 6: Verify

After writing, run a quick sanity check:

1. The `[Unreleased]` section contains the new entries
2. No existing version sections were modified
3. Each entry appears in both Chinese and English (if the project uses bilingual format)
4. No duplicate entries (e.g., don't list the same change under both Added and Changed)

## Edge cases

- **No tags exist:** Analyze all commits from the repo root. Note in the changelog that this covers the initial development period.
- **No commits since last tag:** Report that there are no changes to document. Don't create empty entries.
- **Merge commits:** Look at the diff, not the merge commit message. The diff tells you what actually changed.
- **Squashed commits:** A single squashed commit may contain many changes. Decompose based on the diff, not the single commit message.
- **Existing `[Unreleased]` content:** If there are already entries under `[Unreleased]`, merge the new entries into the existing categories. Don't delete what's already there.
- **Non-bilingual projects:** If the existing CHANGELOG.md uses only one language, match that style. Don't force bilingual entries where they don't belong.

## What not to do

- Don't list test files as changelog entries — tests validate changes, they aren't changes themselves
- Don't list internal tooling changes (eslint config, CI config) unless they affect users
- Don't include commit hashes in changelog entries
- Don't modify version sections that already exist in the file
- Don't create a new version section — that's a separate release preparation step
- Don't list changes to `README.md`, `docs/README.en.md`, or `package.json` — version bumps, keyword additions, badge updates, and README rewrites are metadata that reflect changes already captured elsewhere
