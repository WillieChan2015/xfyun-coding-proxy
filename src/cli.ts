import { Command } from 'commander';

export interface CliOptions {
  port: number;
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  retryDelay: number;
  verbose: boolean;
}

export function parseCli(): CliOptions {
  const program = new Command();

  program
    .name('xfyun-coding-proxy')
    .description('Local proxy for iFlytek Xingchen Coding Plan API (OpenAI-compatible)')
    .version('1.0.0')
    .option('-p, --port <port>', 'proxy listen port', process.env.PORT || '3000')
    .option('-k, --api-key <key>', 'iFlytek Coding Plan API key')
    .option(
      '--base-url <url>',
      'iFlytek API base URL',
      process.env.XFYUN_BASE_URL || 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
    )
    .option('--max-retries <n>', 'max retry attempts', process.env.MAX_RETRIES || '3')
    .option('--retry-delay <ms>', 'initial retry delay in ms', process.env.RETRY_DELAY_MS || '1000')
    .option('-v, --verbose', 'enable debug logging')
    .parse();

  const opts = program.opts();

  return {
    port: parseInt(opts.port, 10),
    apiKey: opts.apiKey || process.env.XFYUN_API_KEY || '',
    baseUrl: opts.baseUrl,
    maxRetries: parseInt(opts.maxRetries, 10),
    retryDelay: parseInt(opts.retryDelay, 10),
    verbose: opts.verbose ?? false,
  };
}
