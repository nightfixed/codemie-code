/**
 * Start-up side-effect gating (CR-001).
 *
 * `runStartupSideEffects` is the source-level home of the `bin/codemie.js`
 * dry-run guards. These tests pin that a `--dry-run` argv skips all three
 * writing side effects (pending migrations, the update check, and the
 * once-per-upgrade notice), and that a normal invocation runs them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const migrations = vi.hoisted(() => ({
  hasPending: vi.fn(),
  runPending: vi.fn(),
}));
vi.mock('@/migrations/index.js', () => ({ MigrationRunner: migrations }));

const updater = vi.hoisted(() => ({ checkAndPromptForUpdate: vi.fn() }));
vi.mock('@/utils/cli-updater.js', () => ({ checkAndPromptForUpdate: updater.checkAndPromptForUpdate }));

const whatsnew = vi.hoisted(() => ({
  shouldRunUpgradeNotice: vi.fn(),
  showUpgradeNotice: vi.fn(),
}));
vi.mock('@/utils/whatsnew.js', () => whatsnew);

vi.mock('@/utils/logger.js', () => ({ logger: { warn: vi.fn() } }));

import { runStartupSideEffects } from './startup.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runStartupSideEffects', () => {
  it('skips migrations, the update check and the upgrade notice for a dry run', async () => {
    migrations.hasPending.mockResolvedValue(true);

    await runStartupSideEffects({
      argv: ['install', '--dry-run'],
      isHookProcess: false,
      isTestEnvironment: false,
    });

    expect(migrations.hasPending).not.toHaveBeenCalled();
    expect(migrations.runPending).not.toHaveBeenCalled();
    expect(updater.checkAndPromptForUpdate).not.toHaveBeenCalled();
    expect(whatsnew.showUpgradeNotice).not.toHaveBeenCalled();
  });

  it('runs all three side effects for a normal invocation with pending migrations', async () => {
    migrations.hasPending.mockResolvedValue(true);
    whatsnew.shouldRunUpgradeNotice.mockReturnValue(true);

    await runStartupSideEffects({
      argv: ['install'],
      isHookProcess: false,
      isTestEnvironment: false,
    });

    expect(migrations.runPending).toHaveBeenCalledWith({ silent: false });
    expect(updater.checkAndPromptForUpdate).toHaveBeenCalled();
    expect(whatsnew.showUpgradeNotice).toHaveBeenCalled();
  });

  it('skips the update check and notice in test environments but still runs migrations', async () => {
    migrations.hasPending.mockResolvedValue(true);

    await runStartupSideEffects({
      argv: ['install'],
      isHookProcess: false,
      isTestEnvironment: true,
    });

    expect(migrations.runPending).toHaveBeenCalledWith({ silent: false });
    expect(updater.checkAndPromptForUpdate).not.toHaveBeenCalled();
    expect(whatsnew.showUpgradeNotice).not.toHaveBeenCalled();
  });
});
