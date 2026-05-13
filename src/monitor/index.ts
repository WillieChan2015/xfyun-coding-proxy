import { render } from 'ink';
import React from 'react';
import { MonitorApp } from './app';

/**
 * 启动 Ink 监控面板，返回控制句柄
 * @param onQuit - 按 q 退出时的回调，由调用方实现优雅关停（保存 stats、关 server、exit）
 */
export function startMonitor(name: string, version: string, onQuit: () => void): { unmount: () => void } {
  let unmounted = false;

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
  );

  return { unmount: () => {
    if (!unmounted) {
      unmounted = true;
      handle.unmount();
    }
  }};
}
