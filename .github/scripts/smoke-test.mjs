import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const SMOKE_PORT = 3001;
const SMOKE_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_INTERVAL_MS = 500;

/**
 * 冒烟测试：启动服务 → 等待端口可连接 → 关闭服务
 * 用于 release 流程中验证源码运行和构建产物运行均正常
 * @param {string} command - 启动命令（如 'pnpm' 或 'node'）
 * @param {string[]} args - 启动参数（如 ['start', '--port', '3001'] 或 ['dist/index.js', '--port', '3001']）
 * @param {object} [options]
 * @param {object} [options.logger] - 日志输出，默认 console
 * @returns {Promise<void>}
 */
export async function smokeTest(command, args, options = {}) {
  const logger = options.logger ?? console;
  const label = `${command} ${args.join(' ')}`;
  logger.log(`Smoke test: starting ${label}`);

  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, XFYUN_API_KEY: 'smoke-test-key', MONITOR: 'false' },
  });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  try {
    await waitForPort(SMOKE_PORT, SMOKE_TIMEOUT_MS);
    logger.log(`Smoke test: ${label} — port ${SMOKE_PORT} is reachable`);
  } finally {
    // 无论成功或失败，都必须关闭子进程
    child.kill('SIGTERM');
    // 给进程 5s 优雅退出，否则强制杀死
    const forceKill = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    await new Promise((resolve) => {
      child.on('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
      // 如果进程已经退出，直接 resolve
      if (child.exitCode !== null) {
        clearTimeout(forceKill);
        resolve();
      }
    });
  }

  // 检查退出码：被 SIGTERM 杀死是正常的（exitCode=null, signal='SIGTERM'）
  if (child.exitCode !== null && child.exitCode !== 0) {
    throw new Error(
      `Smoke test failed: ${label} exited with code ${child.exitCode}\n${stderrOutput}`,
    );
  }
}

/**
 * 轮询等待指定端口可连接
 */
function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const tryConnect = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Smoke test: timed out waiting for port ${port} after ${timeoutMs}ms`));
        return;
      }

      const socket = createConnection(port, '127.0.0.1', () => {
        socket.destroy();
        resolve();
      });

      socket.on('error', () => {
        socket.destroy();
        setTimeout(tryConnect, HEALTH_CHECK_INTERVAL_MS);
      });
    };

    tryConnect();
  });
}

// CLI 入口：node .github/scripts/smoke-test.mjs <command> [args...]
// 示例：node .github/scripts/smoke-test.mjs pnpm start --port 3001
//       node .github/scripts/smoke-test.mjs node dist/index.js --port 3001
async function main(argv) {
  if (argv.length < 1) {
    throw new Error(
      'Usage: node .github/scripts/smoke-test.mjs <command> [args...]\n' +
        'Example: node .github/scripts/smoke-test.mjs pnpm start --port 3001\n' +
        '         node .github/scripts/smoke-test.mjs node dist/index.js --port 3001',
    );
  }

  const command = argv[0];
  const args = argv.slice(1);
  await smokeTest(command, args);
}

const scriptPath = import.meta.url;
if (process.argv[1] && scriptPath.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
