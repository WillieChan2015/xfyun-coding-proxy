import { CliOptions } from './cli';
import { resolveLogDir } from './config';
import {
  todayStr,
  isValidDate,
  loadDailyStats,
  printDailyStats,
  printStatsHistory,
} from './stats';

export function handleStatsCommand(opts: CliOptions): void {
  const logDir = resolveLogDir(undefined);
  const date = opts.statsDate;

  if (opts.statsList) {
    printStatsHistory(logDir);
    return;
  }

  if (date) {
    if (!isValidDate(date)) {
      console.error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
      process.exit(1);
    }
    const stats = loadDailyStats(logDir, date);
    printDailyStats(date, stats);
    return;
  }

  // Default: show today
  const today = todayStr();
  const stats = loadDailyStats(logDir, today);
  printDailyStats(today, stats);
}
