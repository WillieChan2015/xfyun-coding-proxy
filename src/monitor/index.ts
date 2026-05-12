import { render } from 'ink';
import React from 'react';
import { MonitorApp } from './app';

/**
 * 启动 Ink 监控面板，返回控制句柄
 * 调用方在需要退出时调用 handle.unmount()
 */
export function startMonitor(version: string): { unmount: () => void } {
  let unmounted = false;

  const handle = render(
    React.createElement(MonitorApp, {
      version,
      onQuit: () => {
        if (!unmounted) {
          unmounted = true;
          handle.unmount();
        }
      },
    }),
  );

  return { unmount: () => handle.unmount() };
}
