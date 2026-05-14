import { render } from 'ink';
import React from 'react';
import { MonitorApp } from './app';

/**
 * 启动 Ink 监控面板，返回控制句柄
 * @param onQuit - 按 q 退出时的回调，由调用方实现优雅关停（保存 stats、关 server、exit）
 */
export function startMonitor(name: string, version: string, onQuit: () => void): { unmount: () => void } {
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
