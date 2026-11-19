#!/usr/bin/env node
import { runCli } from '../dist/esm/cli/index.js';

runCli().catch((error) => {
  console.error('Fatal @octokern/config CLI error:', error);
  process.exitCode = 1;
});
