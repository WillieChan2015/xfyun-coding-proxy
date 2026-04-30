import { describe, expect, it } from 'bun:test';
import {
  parseReleaseAutomationArgs,
  runReleaseAutomation,
} from '../../.github/scripts/release-auto.mjs';

type Preview = Awaited<ReturnType<typeof runReleaseAutomation>> extends infer _T
  ? {
      requestedInput: string;
      currentVersion: string;
      targetVersion: string;
      targetTag: string;
      isPrerelease: boolean;
      releaseCommitMessage: string;
      releaseNotes: string;
      blockers: string[];
      nextStep: string;
      changelogPlan: {
        source: string;
        existingTargetHeading: boolean;
        releaseHeading: string;
        releaseSectionPreview: string;
        unreleasedTemplate: string;
        unreleasedSectionPreview: string;
      };
    }
  : never;

function createPreview(overrides: Partial<Preview> = {}): Preview {
  return {
    requestedInput: 'patch',
    currentVersion: '0.0.1-alpha',
    targetVersion: '0.0.2',
    targetTag: 'v0.0.2',
    isPrerelease: false,
    releaseCommitMessage: 'chore: release v0.0.2',
    releaseNotes: 'pending notes',
    blockers: [],
    nextStep: 'pnpm release:prepare patch',
    changelogPlan: {
      source: 'promoted-from-unreleased',
      existingTargetHeading: false,
      releaseHeading: '## [0.0.2] - 2026-04-30',
      releaseSectionPreview: '## [0.0.2] - 2026-04-30\n\npending notes',
      unreleasedTemplate: '### Added / 新增\n\n### Changed / 变更\n\n### Fixed / 修复',
      unreleasedSectionPreview:
        '## [Unreleased]\n\n### Added / 新增\n\n### Changed / 变更\n\n### Fixed / 修复',
    },
    ...overrides,
  };
}

function createLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (...args: unknown[]) => {
        lines.push(args.join(' '));
      },
      error: (...args: unknown[]) => {
        lines.push(args.join(' '));
      },
    },
  };
}

describe('parseReleaseAutomationArgs', () => {
  it('parses version input and boolean flags', () => {
    expect(parseReleaseAutomationArgs(['patch', '--dry-run', '--push', '--yes'])).toEqual({
      versionInput: 'patch',
      dryRun: true,
      push: true,
      yes: true,
    });
  });

  it('rejects unknown flags', () => {
    expect(() => parseReleaseAutomationArgs(['patch', '--wat'])).toThrow(
      'Unknown option: --wat',
    );
  });
});

describe('runReleaseAutomation', () => {
  it('prints the preview and exits early in dry-run mode', async () => {
    const { lines, logger } = createLogger();
    const commandCalls: Array<[string, string[]]> = [];
    let prepareCalled = false;

    const result = await runReleaseAutomation('patch', {
      dryRun: true,
      logger,
      previewFn: async () => createPreview(),
      formatPreviewFn: () => 'formatted preview',
      runCommand: (command, args) => {
        commandCalls.push([command, args]);
        return '';
      },
      prepareFn: async () => {
        prepareCalled = true;
        return { version: '0.0.2', tagName: 'v0.0.2' };
      },
      verifyFn: async () => '0.0.2',
    });

    expect(result.status).toBe('dry-run');
    expect(result.preview.targetTag).toBe('v0.0.2');
    expect(commandCalls).toEqual([]);
    expect(prepareCalled).toBe(false);
    expect(lines.join('\n')).toContain('formatted preview');
    expect(lines.join('\n')).toContain('dry-run');
  });

  it('asks for confirmation, then runs checks, prepares the release, and pushes when enabled', async () => {
    const { logger } = createLogger();
    const commandCalls: Array<[string, string[]]> = [];
    const prepareCalls: string[] = [];
    const verifyCalls: Array<[string, string]> = [];
    let confirmCalls = 0;

    const result = await runReleaseAutomation('patch', {
      push: true,
      logger,
      previewFn: async () => createPreview(),
      formatPreviewFn: () => 'formatted preview',
      confirmFn: async (preview, context) => {
        confirmCalls += 1;
        expect(preview.targetVersion).toBe('0.0.2');
        expect(context.push).toBe(true);
        return true;
      },
      runCommand: (command, args) => {
        commandCalls.push([command, args]);
        return '';
      },
      prepareFn: async (versionInput) => {
        prepareCalls.push(versionInput);
        return { version: '0.0.2', tagName: 'v0.0.2' };
      },
      verifyFn: async (packageJsonPath = 'package.json', changelogPath = 'CHANGELOG.md') => {
        verifyCalls.push([packageJsonPath, changelogPath]);
        return '0.0.2';
      },
    });

    expect(confirmCalls).toBe(1);
    expect(prepareCalls).toEqual(['patch']);
    expect(verifyCalls).toEqual([['package.json', 'CHANGELOG.md']]);
    expect(commandCalls).toEqual([
      ['pnpm', ['test']],
      ['pnpm', ['build']],
      ['git', ['diff', '--check']],
      ['git', ['push']],
      ['git', ['push', '--tags']],
    ]);
    expect(result.status).toBe('pushed');
    if (result.status !== 'pushed') {
      throw new Error(`expected pushed result, got ${result.status}`);
    }
    expect(result.prepared.tagName).toBe('v0.0.2');
  });

  it('fails fast when dry-run preview reports blockers', async () => {
    await expect(
      runReleaseAutomation('patch', {
        logger: createLogger().logger,
        previewFn: async () =>
          createPreview({
            blockers: ['Unreleased section is empty'],
            changelogPlan: {
              ...createPreview().changelogPlan,
              source: 'blocked',
            },
            releaseNotes: '',
          }),
        formatPreviewFn: () => 'formatted preview',
        runCommand: () => '',
        prepareFn: async () => ({ version: '0.0.2', tagName: 'v0.0.2' }),
        verifyFn: async () => '0.0.2',
      }),
    ).rejects.toThrow('Release automation blocked: Unreleased section is empty');
  });
});
