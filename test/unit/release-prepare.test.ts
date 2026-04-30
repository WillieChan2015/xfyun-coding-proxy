import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const prepareScript = path.join(repoRoot, '.github/scripts/prepare-release.mjs');
const verifyScript = path.join(repoRoot, '.github/scripts/verify-changelog-version.mjs');
const unreleasedTemplate =
  '### Added / 新增\n\n### Changed / 变更\n\n### Fixed / 修复';

async function createTempRepo(options: {
  version?: string;
  changelog?: string;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xfyun-release-prepare-'));
  const version = options.version ?? '0.0.1-alpha';
  const changelog =
    options.changelog ??
    `# Changelog\n\n## [Unreleased]\n\n### Added / 新增\n\n- pending\n\n### Fixed / 修复\n\n- pending fix\n\n## [0.0.1-alpha] - 2026-04-30\n\n### Added / 新增\n\n- initial release\n`;

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-package', version }, null, 2) + '\n',
    'utf8',
  );
  await writeFile(path.join(dir, 'CHANGELOG.md'), changelog, 'utf8');

  runGit(dir, ['init']);
  runGit(dir, ['config', 'user.name', 'Test User']);
  runGit(dir, ['config', 'user.email', 'test@example.com']);
  runGit(dir, ['add', 'package.json', 'CHANGELOG.md']);
  runGit(dir, ['commit', '-m', 'chore: init']);

  return dir;
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('verify-changelog-version.mjs', () => {
  it('passes when CHANGELOG contains the current package version heading', async () => {
    const dir = await createTempRepo({
      version: '0.0.2',
      changelog: `# Changelog\n\n## [0.0.2]\n\n### Added\n\n- release entry\n`,
    });

    expect(() => {
      execFileSync('node', [verifyScript], { cwd: dir, encoding: 'utf8' });
    }).not.toThrow();
  });
});

describe('prepare-release.mjs', () => {
  it('moves Unreleased notes into a new version section, creates a release commit, and tags the new version', async () => {
    const dir = await createTempRepo({});

    execFileSync('node', [prepareScript, '0.0.2'], { cwd: dir, encoding: 'utf8' });

    const packageJson = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const changelog = await readFile(path.join(dir, 'CHANGELOG.md'), 'utf8');

    expect(packageJson.version).toBe('0.0.2');
    expect(changelog).toContain(`## [Unreleased]\n\n${unreleasedTemplate}\n\n## [0.0.2] - `);
    expect(changelog).toContain('## [0.0.2] - ');
    expect(changelog).toContain('### Added / 新增\n\n- pending\n\n### Fixed / 修复\n\n- pending fix');
    expect(changelog).not.toContain('## [Unreleased]\n\n### Added / 新增\n\n- pending');
    expect(runGit(dir, ['log', '-1', '--pretty=%s'])).toBe('chore: release v0.0.2');
    expect(runGit(dir, ['tag', '--list', 'v0.0.2'])).toBe('v0.0.2');
  });

  it('fails and restores package.json when Unreleased only contains the empty template', async () => {
    const dir = await createTempRepo({
      changelog: `# Changelog\n\n## [Unreleased]\n\n${unreleasedTemplate}\n\n## [0.0.1-alpha] - 2026-04-30\n\n### Added / 新增\n\n- initial release\n`,
    });

    expect(() => {
      execFileSync('node', [prepareScript, '0.0.2'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    }).toThrow('Unreleased section is empty; cannot create changelog entry for version 0.0.2');

    const packageJson = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(packageJson.version).toBe('0.0.1-alpha');
    expect(runGit(dir, ['tag', '--list', 'v0.0.2'])).toBe('');
    expect(runGit(dir, ['log', '-1', '--pretty=%s'])).toBe('chore: init');
  });
});
