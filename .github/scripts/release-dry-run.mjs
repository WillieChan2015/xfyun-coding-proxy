import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { extractReleaseNotes } from './extract-release-notes.mjs';
import { prepareChangelogForRelease, UNRELEASED_TEMPLATE } from './prepare-release.mjs';

// 显式版本输入与 npm 语义 bump 关键字需要区分处理；前者直接使用，后者交给 npm 解析。
const EXPLICIT_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// 版本号会拼进正则里，先转义可避免误把字符当作模式语法。
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 对外允许传 `v1.2.3` 或 `1.2.3`，内部统一成裸 semver 处理。
function normalizeVersionInput(versionInput) {
  return versionInput.startsWith('v') ? versionInput.slice(1) : versionInput;
}

// 读取目标版本标题时保留完整标题文本，方便直接展示给用户预览。
function findVersionHeading(changelog, version) {
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s*-\\s*.+)?$`, 'm');
  return headingPattern.exec(changelog)?.[0] ?? `## [${version}]`;
}

// 这里只关心“标题是否已存在”，用于区分复用已有章节还是从 Unreleased 提升。
function hasVersionHeading(changelog, version) {
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s*-\\s*.+)?$`, 'm');
  return headingPattern.test(changelog);
}

// dry-run 会读 package.json 当前版本，因此先做一次最小字段校验。
function readPackageVersion(packageJsonContent) {
  const packageJson = JSON.parse(packageJsonContent);
  if (!packageJson.version || typeof packageJson.version !== 'string') {
    throw new Error('package.json is missing a valid version field');
  }

  return packageJson.version;
}

// 统一外部命令执行行为，便于在一个地方约束编码和输出模式。
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

// 对 npm bump 关键字（如 patch/minor/prerelease）复用 `npm version` 的原生语义，
// 但把计算放在临时目录里完成，确保 dry-run 不会污染真实工作区。
export async function resolveTargetVersion(currentVersion, versionInput) {
  const normalizedInput = normalizeVersionInput(versionInput);

  if (EXPLICIT_VERSION_PATTERN.test(versionInput)) {
    return normalizedInput;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'xfyun-release-version-'));

  try {
    await writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'release-dry-run-preview', version: currentVersion }, null, 2) + '\n',
      'utf8',
    );
    // 通过临时 package.json 调用 npm version，拿到与真实发布一致的 bump 结果。
    run('npm', ['version', normalizedInput, '--no-git-tag-version', '--force'], { cwd: tempDir });
    const updatedPackageJson = await readFile(path.join(tempDir, 'package.json'), 'utf8');
    return readPackageVersion(updatedPackageJson);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// 预演输出里的“下一步”提示要根据是否存在 blocker 动态变化，避免误导用户继续执行。
function buildNextStep(versionInput, blockers) {
  if (blockers.length > 0) {
    return '先修复阻塞项，再重新执行 dry-run 或切换到 /release。';
  }

  return `pnpm release:prepare ${versionInput}`;
}

// 生成只读预演结果：不修改仓库，仅预测目标版本、tag、changelog 来源、release notes 与阻塞项。
export async function previewReleaseDryRun(versionInput, options = {}) {
  if (!versionInput) {
    throw new Error('Usage: node .github/scripts/release-dry-run.mjs <version|npm-version-argument>');
  }

  const packageJsonPath = options.packageJsonPath ?? 'package.json';
  const changelogPath = options.changelogPath ?? 'CHANGELOG.md';
  const releaseDate = options.releaseDate;

  const packageJsonContent = await readFile(packageJsonPath, 'utf8');
  const currentVersion = readPackageVersion(packageJsonContent);
  const targetVersion = await resolveTargetVersion(currentVersion, versionInput);
  const targetTag = `v${targetVersion}`;
  const changelog = await readFile(changelogPath, 'utf8');
  const targetHeadingExists = hasVersionHeading(changelog, targetVersion);
  const blockers = [];

  let preparedChangelog = changelog;
  let releaseNotes = '';
  let changelogSource = targetHeadingExists ? 'existing-version-heading' : 'promoted-from-unreleased';

  try {
    // 直接复用真实发版的 changelog 迁移逻辑，保证预演结果和实际执行一致。
    preparedChangelog = prepareChangelogForRelease(changelog, targetVersion, releaseDate);
    releaseNotes = extractReleaseNotes(preparedChangelog, targetTag);
  } catch (error) {
    // dry-run 不应吞掉阻塞原因，而是把它们转成结构化输出交给上层展示。
    blockers.push(error instanceof Error ? error.message : String(error));
    changelogSource = 'blocked';
  }

  const releaseHeading = findVersionHeading(preparedChangelog, targetVersion);
  const releaseSectionPreview = releaseNotes ? `${releaseHeading}\n\n${releaseNotes}` : '';
  const unreleasedSectionPreview = `## [Unreleased]\n\n${UNRELEASED_TEMPLATE}`;

  return {
    requestedInput: versionInput,
    currentVersion,
    targetVersion,
    targetTag,
    isPrerelease: targetVersion.includes('-'),
    releaseCommitMessage: `chore: release ${targetTag}`,
    releaseNotes,
    blockers,
    nextStep: buildNextStep(versionInput, blockers),
    changelogPlan: {
      source: changelogSource,
      existingTargetHeading: targetHeadingExists,
      releaseHeading,
      releaseSectionPreview,
      unreleasedTemplate: UNRELEASED_TEMPLATE,
      unreleasedSectionPreview,
    },
  };
}

// 把结构化预演结果转成适合 CLI 直接展示的 Markdown 文本，方便人类快速 review。
export function formatReleaseDryRunPreview(preview) {
  const lines = [
    '# Release Dry Run',
    '',
    `- 当前版本：\`${preview.currentVersion}\``,
    `- 目标版本：\`${preview.targetVersion}\``,
    `- 预计 tag：\`${preview.targetTag}\``,
    `- 预计 commit：\`${preview.releaseCommitMessage}\``,
    `- 预发布：${preview.isPrerelease ? '是' : '否'}`,
    '',
    '## Changelog 计划',
    '',
    `- 来源：\`${preview.changelogPlan.source}\``,
    `- 目标章节：\`${preview.changelogPlan.releaseHeading}\``,
    '',
    '## 发版后 Unreleased 模板',
    '',
    preview.changelogPlan.unreleasedSectionPreview,
    '',
  ];

  if (preview.releaseNotes) {
    lines.push('## Release Notes 预览', '', preview.changelogPlan.releaseSectionPreview, '');
  }

  if (preview.blockers.length > 0) {
    lines.push('## 阻塞项', '', ...preview.blockers.map((item) => `- ${item}`), '');
  }

  lines.push('## 下一步', '', `- ${preview.nextStep}`);

  return lines.join('\n');
}

// CLI 入口保持只读行为：读取预演结果并打印，不做任何版本或 git 状态变更。
async function main(argv) {
  const preview = await previewReleaseDryRun(argv[0]);
  console.log(formatReleaseDryRunPreview(preview));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
