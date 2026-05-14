/**
 * Monitor 模块的 CJS 桥接入口
 *
 * ink 是纯 ESM 包且含 top-level await，无法在 CJS 中用 require() 加载。
 * 此文件由 tsc 编译为 CJS，通过动态 import() 异步加载 bun 打包的 ESM bundle (dist/monitor.js)，
 * 只在 cfg.monitor=true 时才触发加载，--no-monitor 时完全不会触及 ink。
 *
 * 路径说明：tsc 将此文件编译到 dist/monitor/index.js，
 * ESM bundle 由 bun 打包到 dist/monitor.js，因此相对路径为 ../monitor.js
 *
 * 使用 Function('return import') 确保 Node.js CJS 环境下 import() 保持为异步动态导入，
 * 而不被 tsc (module: commonjs) 编译为同步 require()。
 */

// Node.js CJS 中保持动态 import 为异步的标准做法
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (path: string) => Promise<any>;

export async function startMonitor(name: string, version: string, onQuit: () => void): Promise<{ unmount: () => void }> {
  const monitor = await dynamicImport('../monitor.js');
  return monitor.startMonitor(name, version, onQuit);
}