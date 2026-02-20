#!/usr/bin/env node

import { runCli } from '../dist/cli.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
