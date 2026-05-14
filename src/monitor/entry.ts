/**
 * Ink 监控面板 ESM 入口
 *
 * 此文件由 bun 单独打包为 dist/monitor.js（ESM 格式），
 * 避免 ink/React 的 ESM + top-level await 与 CJS 编译产物冲突。
 */
import { render } from 'ink';
import React from 'react';
import { MonitorApp } from './app';

export function startMonitor(name: string, version: string, onQuit: () => void) {
  let unmounted = false;

  // exitOnCtrlC: false — 禁用 Ink 默认拦截 Ctrl+C，
  // 改由 MonitorApp 的 useInput 自行处理，确保 Ctrl+C 直接触发 gracefulShutdown
  const handle = render(
    React.createElement(MonitorApp, {
      name,
      version,
      onQuit: () => {
        if (!unmounted) {
          unmounted = true;
          handle.unmount();
          onQuit();
        }
      },
    }),
    { exitOnCtrlC: false },
  );

  return { unmount: () => {
    if (!unmounted) {
      unmounted = true;
      handle.unmount();
    }
  }};
}
