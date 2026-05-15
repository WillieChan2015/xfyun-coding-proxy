import { execFileSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  formatReleaseDryRunPreview,
  previewReleaseDryRun,
} from './release-dry-run.mjs';
import { prepareRelease } from './prepare-release.mjs';
import { verifyChangelogVersion } from './verify-changelog-version.mjs';
import { smokeTest } from './smoke-test.mjs';

// 自动化入口仍然依赖真实外部命令执行，统一包装后更容易在测试里替换掉。
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

// 解析 release:auto 的 CLI 参数：保留一个版本输入，其他都走显式布尔开关。
export function parseReleaseAutomationArgs(argv) {
  const parsed = {
    versionInput: '',
    dryRun: false,
    push: false,
    yes: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--push') {
      parsed.push = true;
      continue;
    }

    if (arg === '--yes') {
      parsed.yes = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      throw new Error(
        'Usage: node .github/scripts/release-auto.mjs <version|npm-version-argument> [--dry-run] [--push] [--yes]',
      );
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (parsed.versionInput) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    parsed.versionInput = arg;
  }

  if (!parsed.versionInput) {
    throw new Error(
      'Usage: node .github/scripts/release-auto.mjs <version|npm-version-argument> [--dry-run] [--push] [--yes]',
    );
  }

  return parsed;
}

// 真实执行前做一次交互确认，避免脚本在用户没准备好的情况下直接改版本、打 tag、push。
async function confirmRelease(preview, context) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const pushHint = context.push ? ' and push commit/tag' : '';
    const answer = await rl.question(
      `Continue with release automation for ${preview.targetTag}${pushHint}? [y/N] `,
    );

    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

// 默认命令执行器单独抽出来，方便测试时用假的 runner 截获命令序列。
function createDefaultCommandRunner() {
  return (command, args, options = {}) => run(command, args, options);
}

// 自动化总控入口只负责编排流程，不重新实现 dry-run / prepare / verify 细节，
// 这样可以确保“一条龙脚本”和现有分步命令始终复用同一套发布规则。
export async function runReleaseAutomation(versionInput, options = {}) {
  if (!versionInput) {
    throw new Error(
      'Usage: node .github/scripts/release-auto.mjs <version|npm-version-argument> [--dry-run] [--push] [--yes]',
    );
  }

  const dryRun = options.dryRun ?? false;
  const push = options.push ?? false;
  const yes = options.yes ?? false;
  const logger = options.logger ?? console;
  const previewFn = options.previewFn ?? previewReleaseDryRun;
  const formatPreviewFn = options.formatPreviewFn ?? formatReleaseDryRunPreview;
  const confirmFn = options.confirmFn ?? confirmRelease;
  const runCommand = options.runCommand ?? createDefaultCommandRunner();
  const prepareFn = options.prepareFn ?? prepareRelease;
  const verifyFn = options.verifyFn ?? verifyChangelogVersion;
  const packageJsonPath = options.packageJsonPath ?? 'package.json';
  const changelogPath = options.changelogPath ?? 'CHANGELOG.md';

  const smokeTestFn = options.smokeTestFn ?? smokeTest;

  // 先跑 dry-run，把目标版本、tag、changelog 迁移和阻塞项一次性展示出来。
  const preview = await previewFn(versionInput, { packageJsonPath, changelogPath });
  logger.log(formatPreviewFn(preview));

  // 任何 blocker 都应在真正改动仓库前终止，避免进入半执行状态。
  if (preview.blockers.length > 0) {
    throw new Error(`Release automation blocked: ${preview.blockers.join('; ')}`);
  }

  logger.log(
    `Planned steps: pnpm test -> smoke test (src) -> pnpm build -> smoke test (dist) -> pnpm release:prepare ${versionInput} -> pnpm release:check -> git diff --check${push ? ' -> git push -> git push --tags' : ''}`,
  );

  // dry-run 模式只打印计划，不执行任何会改动仓库或远端状态的动作。
  if (dryRun) {
    logger.log(`Release automation dry-run complete for ${preview.targetTag}. No changes applied.`);
    return {
      status: 'dry-run',
      preview,
    };
  }

  // `--yes` 适合 CI 或已经确认过的场景；默认仍然要二次确认。
  const confirmed = yes ? true : await confirmFn(preview, { push });
  if (!confirmed) {
    logger.log(`Cancelled release automation for ${preview.targetTag}.`);
    return {
      status: 'cancelled',
      preview,
    };
  }

  // 测试和构建放在真正 bump 版本前执行，避免失败后还得回滚 release 元数据。
  logger.log('Running release preflight: pnpm test');
  runCommand('pnpm', ['test']);

  // 冒烟测试（源码）：验证 pnpm start 能正常启动并监听端口
  logger.log('Running smoke test (source code)...');
  await smokeTestFn('pnpm', ['start', '--port', '3001'], { logger });

  logger.log('Running release preflight: pnpm build');
  runCommand('pnpm', ['build']);

  // 冒烟测试（构建产物）：验证 dist/index.js 能正常启动并监听端口
  logger.log('Running smoke test (dist build)...');
  await smokeTestFn('node', ['dist/index.js', '--port', '3001'], { logger });

  // 真正的版本升级、changelog 迁移、commit 和 tag 创建统一交给 prepareRelease 处理。
  const prepared = await prepareFn(versionInput, { packageJsonPath, changelogPath });
  // prepare 结束后再做一次 changelog 校验，确保当前版本标题确实已落盘。
  const verifiedVersion = await verifyFn(packageJsonPath, changelogPath);

  logger.log(`Verified CHANGELOG.md matches v${verifiedVersion}.`);
  // 这里补一层 diff 格式检查，避免发布 commit 自己引入空白错误。
  logger.log('Checking git diff formatting safety: git diff --check');
  runCommand('git', ['diff', '--check']);

  if (push) {
    // 只有显式要求 `--push` 时才把本地结果推进远端，避免默认行为过于激进。
    logger.log('Pushing release commit: git push');
    runCommand('git', ['push']);
    logger.log('Pushing release tags: git push --tags');
    runCommand('git', ['push', '--tags']);
    logger.log(
      `Release automation pushed ${prepared.tagName}. Next: watch GitHub Actions publish.yml for npm publish and GitHub Release creation.`,
    );

    return {
      status: 'pushed',
      preview,
      prepared,
      verifiedVersion,
    };
  }

  logger.log(`Release automation prepared ${prepared.tagName}. Next: git push && git push --tags`);

  return {
    status: 'prepared',
    preview,
    prepared,
    verifiedVersion,
  };
}

// CLI 入口只做参数解析和异常兜底，业务流程全部走 `runReleaseAutomation()`。
async function main(argv) {
  const parsed = parseReleaseAutomationArgs(argv);
  await runReleaseAutomation(parsed.versionInput, parsed);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
