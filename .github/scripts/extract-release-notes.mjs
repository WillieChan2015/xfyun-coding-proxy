import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 从动态字符串构造正则时统一做转义，避免版本号等文本被误当成正则语法。
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Git tag 约定带 `v` 前缀，而 CHANGELOG 标题使用裸 semver，这里做一次归一化。
function normalizeTagToVersion(tagName) {
  return tagName.startsWith('v') ? tagName.slice(1) : tagName;
}

// 从完整 changelog 文本中提取指定 tag 对应的版本段落，供 GitHub Release 正文复用。
export function extractReleaseNotes(changelog, tagName) {
  const version = normalizeTagToVersion(tagName);
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s*-\\s*.+)?$`, 'm');
  const headingMatch = headingPattern.exec(changelog);

  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error(`Could not find changelog section for version ${version}`);
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const remaining = changelog.slice(sectionStart);
  // 一旦遇到下一个版本标题就立刻截断，避免把后续版本或 Unreleased 内容串进来。
  const nextHeadingIndex = remaining.search(/\n## \[[^\]]+\](?:\s*-.*)?/);
  const section = nextHeadingIndex === -1 ? remaining : remaining.slice(0, nextHeadingIndex);
  const releaseNotes = section.trim();

  if (!releaseNotes) {
    throw new Error(`Changelog section for version ${version} is empty`);
  }

  return releaseNotes;
}

// 在 workflow 中把提取结果落到文件，方便后续 `gh release create --notes-file` 或同类流程复用。
export async function writeReleaseNotesFile(tagName, changelogPath, outputPath) {
  const changelog = await readFile(changelogPath, 'utf8');
  const releaseNotes = extractReleaseNotes(changelog, tagName);
  await writeFile(outputPath, releaseNotes, 'utf8');
}

// CLI 入口只负责参数转发，核心逻辑保持在可测试的纯函数里。
async function main(argv) {
  const [tagName, changelogPath = 'CHANGELOG.md', outputPath] = argv;

  if (!tagName || !outputPath) {
    throw new Error(
      'Usage: node .github/scripts/extract-release-notes.mjs <tag> [changelog-path] <output-path>',
    );
  }

  await writeReleaseNotesFile(tagName, changelogPath, outputPath);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
