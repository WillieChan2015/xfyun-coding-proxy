import { describe, expect, it } from 'bun:test';
import {
  evaluateReleaseGuard,
  getCommandText,
} from '../../.github/scripts/release-guard-hook.mjs';

describe('getCommandText', () => {
  it('extracts the terminal command from common hook payload shapes', () => {
    expect(
      getCommandText({
        toolName: 'run_in_terminal',
        toolInput: { command: 'pnpm release:prepare 0.0.2' },
      }),
    ).toBe('pnpm release:prepare 0.0.2');
  });
});

describe('evaluateReleaseGuard', () => {
  it('denies direct local publish commands', () => {
    expect(
      evaluateReleaseGuard({
        toolName: 'run_in_terminal',
        toolInput: { command: 'pnpm publish --access public' },
      }),
    ).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
      },
    });
  });

  it('asks for confirmation before release preparation commands', () => {
    const decision = evaluateReleaseGuard({
      toolName: 'run_in_terminal',
      toolInput: { command: 'pnpm release:prepare 0.0.2' },
    });

    expect(decision).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'ask',
      },
    });
    expect(decision?.systemMessage).toContain('pnpm release:dry-run 0.0.2');
  });

  it('asks for confirmation before automated release commands', () => {
    const decision = evaluateReleaseGuard({
      toolName: 'run_in_terminal',
      toolInput: { command: 'pnpm release:auto patch --push --yes' },
    });

    expect(decision).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'ask',
      },
    });
    expect(decision?.systemMessage).toContain('pnpm release:auto patch --dry-run');
  });

  it('asks for confirmation before pushing release tags', () => {
    expect(
      evaluateReleaseGuard({
        toolName: 'run_in_terminal',
        toolInput: { command: 'git push --tags' },
      }),
    ).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'ask',
      },
    });
  });

  it('allows automated release dry-run commands to continue', () => {
    expect(
      evaluateReleaseGuard({
        toolName: 'run_in_terminal',
        toolInput: { command: 'pnpm release:auto patch --dry-run' },
      }),
    ).toBeNull();
  });

  it('allows unrelated terminal commands to continue', () => {
    expect(
      evaluateReleaseGuard({
        toolName: 'run_in_terminal',
        toolInput: { command: 'pnpm test' },
      }),
    ).toBeNull();
  });
});
