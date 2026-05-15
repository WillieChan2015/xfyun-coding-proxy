#!/usr/bin/env node
import { parseCli } from './cli';
import { loadConfig, promptMissingConfig, validateConfig } from './config';
import { createServer, startServer } from './server';
import { handleStatsCommand } from './stats-cmd';
import { handleSetupCommand } from './setup-cmd';
import { handleRestoreCommand } from './setup/restore-cmd';

async function main() {
  const cliOpts = parseCli();

  if (cliOpts.command === 'stats') {
    handleStatsCommand(cliOpts);
    return;
  }

  if (cliOpts.command === 'setup') {
    await handleSetupCommand(cliOpts);
    return;
  }

  if (cliOpts.command === 'setup-restore') {
    await handleRestoreCommand(cliOpts);
    return;
  }

  const cfg = loadConfig(cliOpts);
  await promptMissingConfig(cfg);
  validateConfig(cfg);
  const server = await createServer(cfg);
  await startServer(server, cfg);
}

main().catch((err) => {
  if (err instanceof Error && err.message.startsWith('Configuration validation failed')) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
