import { Command } from 'commander';

export interface CliOptions {
  port?: number;
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
  verbose: boolean;
  logDir?: string;
  config?: string;
  command?: 'start' | 'stats';
  statsDate?: string;
  statsList?: boolean;
}

export function parseCli(): CliOptions {
  const program = new Command();
  let result: CliOptions | undefined;

  program
    .name('maas-coding-proxy')
    .description('Local proxy for iFlytek Xingchen Coding Plan API (OpenAI-compatible)')
    .version('0.0.1-alpha');

  program
    .command('start', { isDefault: true })
    .description('Start the proxy server')
    .option('-p, --port <port>', 'proxy listen port (default: $PORT or 3000)')
    .option('-k, --api-key <key>', 'iFlytek Coding Plan API key (default: $XFYUN_API_KEY)')
    .option(
      '--base-url <url>',
      'iFlytek API base URL (default: $XFYUN_BASE_URL)',
    )
    .option('--max-retries <n>', 'max retry attempts (default: $MAX_RETRIES or 3)')
    .option('--retry-delay <ms>', 'initial retry delay in ms (default: $RETRY_DELAY_MS or 1000)')
    .option('--log-dir <dir>', 'log output directory (default: $XFYUN_LOG_DIR or XDG state dir)')
    .option('-c, --config <path>', 'path to config file')
    .option('-v, --verbose', 'enable debug logging')
    .action((opts) => {
      result = {
        command: 'start',
        port: opts.port ? parseInt(opts.port, 10) : undefined,
        apiKey: opts.apiKey || undefined,
        baseUrl: opts.baseUrl || undefined,
        maxRetries: opts.maxRetries ? parseInt(opts.maxRetries, 10) : undefined,
        retryDelay: opts.retryDelay ? parseInt(opts.retryDelay, 10) : undefined,
        verbose: opts.verbose ?? false,
        logDir: opts.logDir || undefined,
        config: opts.config || undefined,
      };
    });

  program
    .command('stats')
    .description('Show usage statistics')
    .option('-d, --date <YYYY-MM-DD>', 'show stats for a specific date')
    .option('-l, --list', 'list all dates with stats')
    .action((opts) => {
      result = {
        verbose: false,
        command: 'stats',
        statsDate: opts.date || undefined,
        statsList: opts.list ?? false,
      };
    });

  program.parse();

  return result!;
}
