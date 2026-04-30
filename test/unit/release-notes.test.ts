import { describe, expect, it } from 'bun:test';
import { extractReleaseNotes } from '../../.github/scripts/extract-release-notes.mjs';

const sampleChangelog = `# Changelog / 更新日志

## [Unreleased]

### Added / 新增

- work in progress

## [0.0.2-beta.1] - 2026-05-01

### Added / 新增

- beta feature

### Fixed / 修复

- beta bug

## [0.0.1-alpha] - 2026-04-30

### Added / 新增

- initial release
`;

describe('extractReleaseNotes', () => {
  it('extracts the matching version section by tag name', () => {
    expect(extractReleaseNotes(sampleChangelog, 'v0.0.2-beta.1')).toBe(
      '### Added / 新增\n\n- beta feature\n\n### Fixed / 修复\n\n- beta bug',
    );
  });

  it('supports the last version section in the changelog', () => {
    expect(extractReleaseNotes(sampleChangelog, 'v0.0.1-alpha')).toBe('### Added / 新增\n\n- initial release');
  });

  it('throws a helpful error when the version section is missing', () => {
    expect(() => extractReleaseNotes(sampleChangelog, 'v9.9.9')).toThrow(
      'Could not find changelog section for version 9.9.9',
    );
  });
});
