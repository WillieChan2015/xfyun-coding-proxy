import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { extractReleaseNotes } from './extract-release-notes.mjs';

// 校验当前 package.json.version 在 CHANGELOG 中是否存在对应版本段落；
// 这里直接复用 release notes 提取逻辑，避免出现“校验规则”和“发布规则”不一致。
export async function verifyChangelogVersion(packageJsonPath = 'package.json', changelogPath = 'CHANGELOG.md') {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const changelog = await readFile(changelogPath, 'utf8');
  const tagName = `v${packageJson.version}`;

  extractReleaseNotes(changelog, tagName);
  return packageJson.version;
}

// CLI 入口只负责打印校验结果，方便被 npm scripts 直接调用。
async function main() {
  const version = await verifyChangelogVersion();
  console.log(`CHANGELOG.md contains a release section for v${version}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
