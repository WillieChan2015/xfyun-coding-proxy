#!/usr/bin/env node
import { parseCli } from './cli';
import { loadConfig, promptMissingConfig, validateConfig } from './config';
import { createServer, startServer } from './server';
import { handleStatsCommand } from './stats-cmd';

async function main() {
  const cliOpts = parseCli();

  if (cliOpts.command === 'stats') {
    handleStatsCommand(cliOpts);
    return;
  }

  const cfg = loadConfig(cliOpts);
  await promptMissingConfig(cfg);
  validateConfig(cfg);
  const server = await createServer(cfg);
  await startServer(server, cfg);
}

main();
