#!/usr/bin/env node
import { parseCli } from './cli';
import { loadConfig, promptMissingConfig, validateConfig } from './config';
import { createServer, startServer } from './server';

async function main() {
  const cliOpts = parseCli();
  const cfg = loadConfig(cliOpts);
  await promptMissingConfig(cfg);
  validateConfig(cfg);
  const server = await createServer(cfg);
  await startServer(server, cfg);
}

main();
