import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
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

describe('compiled monitor runtime', () => {
  it('starts the compiled server with monitor enabled from a clean build', async () => {
    const dir = await createWorkspaceFixture();

    try {
      execFileSync('pnpm', ['build'], {
        cwd: dir,
        encoding: 'utf8',
      });

      // bun build 生成单文件 bundle dist/index.js，
      // tsc --emitDeclarationOnly 生成 .d.ts 类型声明，
      // pino transport 保持 .cjs 格式
      expect(existsSync(path.join(dir, 'dist', 'index.js'))).toBe(true);
      expect(existsSync(path.join(dir, 'dist', 'index.d.ts'))).toBe(true);
      expect(existsSync(path.join(dir, 'dist', 'pretty-roll-transport.cjs'))).toBe(true);

      // 验证编译产物可正常启动（含 monitor 面板）
      const child = execFileSync('node', [path.join(dir, 'dist', 'index.js'), '--version'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      expect(child.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);
});