#!/usr/bin/env node

/**
 * CodeMie CLI Wrapper
 * Entry point for the codemie executable
 */

import { logger } from '../dist/utils/logger.js';

// Tolerate EPIPE when stdout/stderr is piped into a consumer that closes early
// (e.g. `codemie | head -1`). Without a handler, Node throws on the next write
// after the pipe closes, crashing the CLI mid-output.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', err => {
    if (err && err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

// A process an agent runs as a hook: its stdout is the agent's protocol channel
// (Claude Code adds a hook's stdout to the model's context), so start-up output
// stays off it, and no update check or prompt runs inside the agent's hook.
// The agent also reads a hook's stderr on a blocking exit as the block reason,
// so the logger never writes to the console there: the log file only.
const isHookProcess = process.argv[2] === 'hook' || process.argv[2] === 'sound';
if (isHookProcess) {
  logger.setConsoleStream(null);
}

// Imported after the console switch: its module graph logs at import time.
const { runStartupSideEffects } = await import('../dist/cli/startup.js');

// `--dry-run` promises that nothing changes on the machine, so the start-up side
// effects that write (pending migrations, the interactive update prompt, and the
// once-per-upgrade notice that records the seen version) are all skipped for it.
// The gating lives in src/cli/startup.ts (testable source); this wrapper passes
// only the raw argv, hook flag and test-environment flag.
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

await runStartupSideEffects({
  argv: process.argv.slice(2),
  isHookProcess,
  isTestEnvironment,
});

// Continue with normal CLI initialization
import('../dist/cli/index.js').catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
