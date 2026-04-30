import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  previewReleaseDryRun,
  resolveTargetVersion,
} from '../../.github/scripts/release-dry-run.mjs';

const unreleasedTemplate =
  '### Added / 新增\n\n### Changed / 变更\n\n### Fixed / 修复';

async function createTempProject(options: {
  version?: string;
  changelog?: string;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xfyun-release-dry-run-'));
  const version = options.version ?? '0.0.1-alpha';
  const changelog =
    options.changelog ??
    `# Changelog\n\n## [Unreleased]\n\n### Added / 新增\n\n- pending feature\n\n### Fixed / 修复\n\n- pending fix\n\n## [0.0.1-alpha] - 2026-04-30\n\n### Added / 新增\n\n- initial release\n`;

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-package', version }, null, 2) + '\n',
    'utf8',
  );
  await writeFile(path.join(dir, 'CHANGELOG.md'), changelog, 'utf8');

  return dir;
}

describe('resolveTargetVersion', () => {
  it('supports npm semver bump keywords without mutating the real workspace', async () => {
    await expect(resolveTargetVersion('1.2.3', 'patch')).resolves.toBe('1.2.4');
  });
});

describe('previewReleaseDryRun', () => {
  it('previews promotion from Unreleased into a new version section', async () => {
    const dir = await createTempProject({});

    const preview = await previewReleaseDryRun('0.0.2', {
      packageJsonPath: path.join(dir, 'package.json'),
      changelogPath: path.join(dir, 'CHANGELOG.md'),
      releaseDate: '2026-04-30',
    });

    expect(preview.currentVersion).toBe('0.0.1-alpha');
    expect(preview.targetVersion).toBe('0.0.2');
    expect(preview.targetTag).toBe('v0.0.2');
    expect(preview.isPrerelease).toBe(false);
    expect(preview.changelogPlan.source).toBe('promoted-from-unreleased');
    expect(preview.changelogPlan.releaseHeading).toBe('## [0.0.2] - 2026-04-30');
    expect(preview.changelogPlan.unreleasedTemplate).toBe(unreleasedTemplate);
    expect(preview.releaseCommitMessage).toBe('chore: release v0.0.2');
    expect(preview.releaseNotes).toContain('pending feature');
    expect(preview.blockers).toEqual([]);
    expect(preview.nextStep).toContain('pnpm release:prepare 0.0.2');
  });

  it('reuses an existing target version section when already present', async () => {
    const dir = await createTempProject({
      changelog: `# Changelog\n\n## [Unreleased]\n\n${unreleasedTemplate}\n\n## [0.0.2-beta.1] - 2026-04-30\n\n### Added / 新增\n\n- beta release notes\n`,
    });

    const preview = await previewReleaseDryRun('0.0.2-beta.1', {
      packageJsonPath: path.join(dir, 'package.json'),
      changelogPath: path.join(dir, 'CHANGELOG.md'),
      releaseDate: '2026-04-30',
    });

    expect(preview.targetVersion).toBe('0.0.2-beta.1');
    expect(preview.isPrerelease).toBe(true);
    expect(preview.changelogPlan.source).toBe('existing-version-heading');
    expect(preview.releaseNotes).toContain('beta release notes');
    expect(preview.blockers).toEqual([]);
  });

  it('reports blockers when Unreleased only contains the empty template', async () => {
    const dir = await createTempProject({
      changelog: `# Changelog\n\n## [Unreleased]\n\n${unreleasedTemplate}\n\n## [0.0.1-alpha] - 2026-04-30\n\n### Added / 新增\n\n- initial release\n`,
    });

    const preview = await previewReleaseDryRun('0.0.2', {
      packageJsonPath: path.join(dir, 'package.json'),
      changelogPath: path.join(dir, 'CHANGELOG.md'),
      releaseDate: '2026-04-30',
    });

    expect(preview.changelogPlan.source).toBe('blocked');
    expect(preview.releaseNotes).toBe('');
    expect(preview.blockers).toContain(
      'Unreleased section is empty; cannot create changelog entry for version 0.0.2',
    );
  });
});
