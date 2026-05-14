import { render } from 'ink';
import React from 'react';
import { MonitorApp, type StatsDeps } from './app';

export { type StatsDeps };

export function startMonitor(name: string, version: string, onQuit: () => void, stats: StatsDeps) {
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
      stats,
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