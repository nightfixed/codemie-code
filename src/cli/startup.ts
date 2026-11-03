/**
 * Start-up side-effect gating for the `codemie` entry point.
 *
 * `--dry-run` promises nothing changes on the machine, so the three start-up side
 * effects that write — pending migrations, the interactive update check, and the
 * once-per-upgrade "what's new" notice that records the seen version — are all
 * skipped for it. This module exists so that gating lives in testable source
 * (the thin `bin/codemie.js` wrapper imports it from `dist/` after build).
 */

import { logger } from '@/utils/logger.js';
import { MigrationRunner } from '@/migrations/index.js';
import { checkAndPromptForUpdate } from '@/utils/cli-updater.js';
import { isDryRunInvocation } from '@/cli/commands/shared/dry-run.js';

export interface StartupScope {
  /** Raw CLI argv (everything after the node/script tokens). */
  argv: string[];
  /** True for a hook process (`hook`, `sound`): output and prompts stay off. */
  isHookProcess: boolean;
  /** Test environments skip the network-bound update check and notice. */
  isTestEnvironment: boolean;
}

/**
 * Runs the three gated start-up side effects, skipping every one of them for a
 * dry-run invocation. Failures are non-fatal by design (mirroring the original
 * `bin/codemie.js` behavior).
 */
export async function runStartupSideEffects(scope: StartupScope): Promise<void> {
  const isDryRun = isDryRunInvocation(scope.argv);

  // Auto-run pending migrations (tracked in ~/.codemie/migrations.json, run once).
  try {
    if (!isDryRun && (await MigrationRunner.hasPending())) {
      await MigrationRunner.runPending({ silent: scope.isHookProcess });
    }
  } catch (error) {
    // Don't block the CLI when a migration fails.
    const message = error instanceof Error ? error.message : String(error);
    if (scope.isHookProcess) {
      logger.warn('Warning: Migration failed:', message);
    } else {
      console.error('Warning: Migration failed:', message);
    }
  }

  // Silent update check; non-blocking failures never prevent the CLI from running.
  if (!scope.isTestEnvironment && !scope.isHookProcess && !isDryRun) {
    try {
      await checkAndPromptForUpdate();
    } catch {
      // Silently fail - don't block CLI startup.
    }
  }

  // Once-per-upgrade "what's new" notice. `--dry-run` skips it: it records the
  // seen version, which is a write.
  if (!scope.isTestEnvironment && !scope.isHookProcess && !isDryRun) {
    try {
      const { readFileSync } = await import('node:fs');
      const { shouldRunUpgradeNotice, showUpgradeNotice } = await import('@/utils/whatsnew.js');

      if (shouldRunUpgradeNotice(scope.argv, process.stdout.isTTY)) {
        const packageJson = JSON.parse(
          readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
        );
        const currentVersion = packageJson.version;
        if (currentVersion) {
          showUpgradeNotice(currentVersion);
        }
      }
    } catch {
      // Silently fail - don't block CLI startup.
    }
  }
}
