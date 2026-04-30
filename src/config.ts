import dotenv from 'dotenv';
import { parseCli, CliOptions } from './cli';

dotenv.config();

const cli = parseCli();

export const config: CliOptions = cli;

export function validateConfig(): void {
  if (!config.apiKey) {
    throw new Error(
      'XFYUN_API_KEY is required. Set it via --api-key, .env, or environment variable.',
    );
  }
}
