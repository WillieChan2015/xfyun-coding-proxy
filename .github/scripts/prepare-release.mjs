import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { extractReleaseNotes } from './extract-release-notes.mjs';

// 版本号和标题文本会被拼进动态正则，统一转义可避免误匹配。
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 发版后会把 `Unreleased` 重建成固定骨架；这里集中维护模板，避免脚本间出现多份常量。
export const UNRELEASED_TEMPLATE = '### Added / 新增\n\n### Changed / 变更\n\n### Fixed / 修复';

// 所有外部命令统一走这个包装层，便于保持编码、输出和错误行为一致。
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

// 发布脚本只关心 version 字段是否可用；缺失时立即失败，避免后面生成错误 tag。
function parsePackageJson(packageJsonContent) {
  const packageJson = JSON.parse(packageJsonContent);
  if (!packageJson.version || typeof packageJson.version !== 'string') {
    throw new Error('package.json is missing a valid version field');
  }

  return packageJson;
}

// 本仓库的 git tag 与 GitHub Release 都以 `v<version>` 形式对齐。
function getTagName(version) {
  return `v${version}`;
}

// 发版日期直接采用本地 UTC 日期，保证 changelog 标题可预测且便于测试注入。
function getReleaseDate() {
  return new Date().toISOString().slice(0, 10);
}

// 只有模板标题、没有真实条目的 `Unreleased` 视为空，必须阻止继续发版。
function hasSubstantiveChangelogContent(sectionBody) {
  return sectionBody
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line && !/^###\s+/.test(line));
}

// 如果目标版本标题还不存在，就把当前 `Unreleased` 提升成带日期的正式版本段落，
// 这样本地 release commit 与 GitHub Release 正文始终引用同一份内容。
export function prepareChangelogForRelease(changelog, version, releaseDate = getReleaseDate()) {
  const targetHeadingPattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?:\\s*-\\s*.+)?$`,
    'm',
  );

  if (targetHeadingPattern.test(changelog)) {
    return changelog;
  }

  const unreleasedHeading = /^## \[Unreleased\]$/m.exec(changelog);
  if (!unreleasedHeading || unreleasedHeading.index === undefined) {
    throw new Error('Could not find Unreleased section in CHANGELOG.md');
  }

  const unreleasedHeadingEnd = unreleasedHeading.index + unreleasedHeading[0].length;
  const remaining = changelog.slice(unreleasedHeadingEnd);
  const nextHeadingIndex = remaining.search(/\n## \[[^\]]+\](?:\s*-.*)?/);
  const unreleasedBodyEnd =
    nextHeadingIndex === -1 ? changelog.length : unreleasedHeadingEnd + nextHeadingIndex;
  const nextHeadingStart =
    nextHeadingIndex === -1 ? changelog.length : unreleasedBodyEnd + 1;
  const unreleasedBody = changelog.slice(unreleasedHeadingEnd, unreleasedBodyEnd).trim();

  if (!hasSubstantiveChangelogContent(unreleasedBody)) {
    throw new Error(
      `Unreleased section is empty; cannot create changelog entry for version ${version}`,
    );
  }

  const prefix = changelog.slice(0, unreleasedHeading.index).trimEnd();
  const suffix =
    nextHeadingStart >= changelog.length ? '' : changelog.slice(nextHeadingStart).trimStart();
  const nextReleaseSection = `## [${version}] - ${releaseDate}\n\n${unreleasedBody}`;
  let updatedChangelog = `${prefix}\n\n## [Unreleased]\n\n${UNRELEASED_TEMPLATE}\n\n${nextReleaseSection}\n`;

  if (suffix) {
    updatedChangelog += `\n${suffix}`;
  }

  return updatedChangelog;
}

// 版本 bump 完成后重新读取 package.json，拿到 npm 语义升级后的真实结果。
async function readCurrentVersion(packageJsonPath) {
  const packageJsonContent = await readFile(packageJsonPath, 'utf8');
  return parsePackageJson(packageJsonContent).version;
}

// README.md 和 docs/README.en.md 中的版本号需要与 package.json 保持一致。
// 匹配"当前版本"/"Current version"标签后反引号内的任意版本号并替换为新版本号，
// 不依赖旧版本号精确匹配，避免 README 版本号滞后于 package.json 时替换失败。
export async function updateReadmeVersions(_oldVersion, newVersion, options = {}) {
  const readmePath = options.readmePath ?? 'README.md';
  const readmeEnPath = options.readmeEnPath ?? 'docs/README.en.md';
  const updatedFiles = [];

  for (const filePath of [readmePath, readmeEnPath]) {
    let content;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      // 文件可能不存在（比如 docs/README.en.md 尚未创建），跳过即可。
      continue;
    }

    const updated = content
      .replace(
        /(当前版本[^`]*`)[^`]+(`)/g,
        `$1${newVersion}$2`,
      )
      .replace(
        /(Current version[^`]*`)[^`]+(`)/g,
        `$1${newVersion}$2`,
      );

    if (updated !== content) {
      await writeFile(filePath, updated, 'utf8');
      updatedFiles.push(filePath);
    }
  }

  return updatedFiles;
}

// 发布脚本只负责创建新 tag，不应覆盖已有 tag；存在即立刻失败。
async function ensureTagDoesNotExist(tagName) {
  try {
    run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`]);
    throw new Error(`Git tag ${tagName} already exists`);
  } catch (error) {
    if (error instanceof Error && error.message === `Git tag ${tagName} already exists`) {
      throw error;
    }
  }
}

// 本地发布准备入口：升级版本、同步 changelog 与 README 版本号、校验 release notes、创建 release commit 与 tag。
// 若过程中任一步失败，会把 package.json、CHANGELOG.md 和 README 文件回滚到调用前状态。
export async function prepareRelease(versionInput, options = {}) {
  if (!versionInput) {
    throw new Error(
      'Usage: node .github/scripts/prepare-release.mjs <version|npm-version-argument>',
    );
  }

  const packageJsonPath = options.packageJsonPath ?? 'package.json';
  const changelogPath = options.changelogPath ?? 'CHANGELOG.md';
  const readmePath = options.readmePath ?? 'README.md';
  const readmeEnPath = options.readmeEnPath ?? 'docs/README.en.md';
  const originalPackageJson = await readFile(packageJsonPath, 'utf8');
  const originalChangelog = await readFile(changelogPath, 'utf8');
  const oldVersion = parsePackageJson(originalPackageJson).version;
  // 提前备份 README 文件原始内容，失败时用于回滚。
  const readmeOriginals = new Map();
  for (const filePath of [readmePath, readmeEnPath]) {
    try {
      readmeOriginals.set(filePath, await readFile(filePath, 'utf8'));
    } catch {
      // 文件可能不存在，跳过即可。
    }
  }
  let versionChanged = false;
  let changelogChanged = false;
  let readmeChanged = false;

  try {
    // 先确认当前目录就是 git 仓库，避免后续 commit/tag 在错误目录里执行。
    run('git', ['rev-parse', '--is-inside-work-tree']);
    // 复用 npm version 的语义化版本规则，避免自己重复实现 bump 逻辑。
    run('npm', ['version', versionInput, '--no-git-tag-version', '--force']);
    versionChanged = true;

    const version = await readCurrentVersion(packageJsonPath);
    const tagName = getTagName(version);

    // 同步 README.md 和 docs/README.en.md 中的版本号，确保 release commit 包含 README 变更。
    const readmeUpdatedFiles = await updateReadmeVersions(oldVersion, version, { readmePath, readmeEnPath });
    if (readmeUpdatedFiles.length > 0) {
      readmeChanged = true;
    }

    const preparedChangelog = prepareChangelogForRelease(originalChangelog, version);

    if (preparedChangelog !== originalChangelog) {
      await writeFile(changelogPath, preparedChangelog, 'utf8');
      changelogChanged = true;
    }

    // 这里顺手校验目标版本段落是否真的可提取，避免 commit/tag 成功后才发现 changelog 不可用。
    extractReleaseNotes(preparedChangelog, tagName);
    await ensureTagDoesNotExist(tagName);

    // 提交 release 元数据文件和 README 变更，避免把工作区里的无关改动"顺手发版"。
    const commitFiles = [packageJsonPath, changelogPath, ...readmeUpdatedFiles];
    run('git', ['commit', '--only', '-m', `chore: release ${tagName}`, '--', ...commitFiles]);
    run('git', ['tag', '-a', tagName, '-m', tagName]);

    console.log(`Prepared ${tagName}.`);
    console.log('Next: git push && git push --tags');

    return { version, tagName };
  } catch (error) {
    // 失败时尽量恢复到调用前状态，避免半更新的版本号、changelog 或 README 留在工作区里。
    if (versionChanged) {
      await writeFile(packageJsonPath, originalPackageJson, 'utf8');
    }

    if (changelogChanged) {
      await writeFile(changelogPath, originalChangelog, 'utf8');
    }

    if (readmeChanged) {
      for (const [filePath, original] of readmeOriginals) {
        await writeFile(filePath, original, 'utf8');
      }
    }

    throw error;
  }
}

// CLI 入口保持极薄，便于测试直接调用 `prepareRelease()`。
async function main(argv) {
  await prepareRelease(argv[0]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
