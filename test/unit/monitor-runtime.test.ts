import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();

async function createWorkspaceFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'xfyun-monitor-runtime-'));

  await cp(repoRoot, dir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(repoRoot, source);
      if (!relative) return true;

      const topLevel = relative.split(path.sep)[0];
      return !['.git', 'dist', 'logs', 'node_modules', 'tmp'].includes(topLevel);
    },
  });

  await symlink(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function runCompiledServer(dir: string) {
  const script = `
    (async () => {
      const { startServer } = require('./dist/server.js');
      const server = {
        listen: async () => {},
        close: async () => {},
        log: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      };

      await startServer(server, {
        port: 3000,
        apiKey: 'test-key',
        baseUrl: 'https://example.com/v2',
        anthropicBaseUrl: 'https://example.com/anthropic',
        maxRetries: 3,
        retryDelay: 1000,
        verbose: false,
        monitor: true,
        logDir: './logs',
        statsDir: './logs/stats',
        statsFlushInterval: 0,
        streamReadTimeout: 60000,
        configFile: undefined,
      });
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  execFileSync('node', ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('compiled monitor runtime', () => {
  it('starts the compiled server with monitor enabled from a clean build', async () => {
    const dir = await createWorkspaceFixture();

    try {
      execFileSync('pnpm', ['build'], {
        cwd: dir,
        encoding: 'utf8',
      });

      expect(existsSync(path.join(dir, 'dist', 'monitor.mjs'))).toBe(true);
      expect(existsSync(path.join(dir, 'dist', 'monitor', 'index.js'))).toBe(false);
      expect(() => runCompiledServer(dir)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

  it('removes stale dist/monitor CJS artifacts before rebuilding', async () => {
    const dir = await createWorkspaceFixture();

    try {
      const staleMonitorDir = path.join(dir, 'dist', 'monitor');
      await mkdir(staleMonitorDir, { recursive: true });
      await writeFile(path.join(staleMonitorDir, 'index.js'), 'module.exports = {}\n', 'utf8');
      await writeFile(path.join(staleMonitorDir, 'app.js'), 'module.exports = {}\n', 'utf8');

      execFileSync('pnpm', ['build'], {
        cwd: dir,
        encoding: 'utf8',
      });

      expect(existsSync(path.join(dir, 'dist', 'monitor', 'index.js'))).toBe(false);
      expect(existsSync(path.join(dir, 'dist', 'monitor', 'app.js'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);
});
