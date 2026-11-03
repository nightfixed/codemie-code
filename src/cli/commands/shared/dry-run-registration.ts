/**
 * Data-driven registration of the shared `--dry-run` flag.
 *
 * `DRY_RUN_REGISTRATIONS` is the contract every dry-run command planner relies
 * on: one row per top-level command (root tier) plus rows for subcommand paths
 * whose tier differs from their parent. A row's tier applies to that path and is
 * inherited by descendants unless a more specific row overrides it.
 *
 * Tiers:
 *  - 1 — first-delivery previews. The flag is registered and execution passes
 *        through untouched: the command's own action builds and prints the plan.
 *  - 2 — read-only. The flag is registered, the read-only footer is printed, and
 *        the command runs exactly as normal.
 *  - 3 — mutating but not previewable yet. The flag is registered, the tier-3
 *        footer is printed, and the action is not run (exit code 0).
 *
 * Absent from the table on purpose: tool-invoked commands (`hook`,
 * `opencode-metrics`, `mcp-proxy`) keep rejecting `--dry-run`. The four legacy
 * preview factories (`skill`, `log`, `workflow`, `test-metrics`) declare their
 * own `--dry-run` and are skipped for now.
 */

import type { Command } from 'commander';

import { createInstallCommand } from '../install.js';
import { createUninstallCommand } from '../uninstall.js';
import { createSetupCommand } from '../setup.js';
import { createProfileCommand } from '../profile/index.js';
import { createProxyCommand } from '../proxy/index.js';
import { createDocsCommand } from '../docs.js';
import { createListCommand } from '../list.js';
import { createVersionCommand } from '../version.js';
import { createDoctorCommand } from '../doctor/index.js';
import { createModelsCommand } from '../models.js';
import { createSoundCommand } from '../sound.js';
import { createTipsCommand } from '../tips.js';
import { createWhatsnewCommand } from '../whatsnew.js';
import { createUpdateCommand } from '../update.js';
import { createSelfUpdateCommand } from '../self-update.js';
import { createPluginCommand } from '../plugin.js';
import { createAnalyticsCommand } from '../analytics/index.js';
import { createCodebaseCommand } from '../codebase/index.js';
import { createSkillsCommand } from '../skills/index.js';
import { createMcpCommand } from '../mcp/index.js';
import { createSdkCommand } from '../sdk/index.js';
import { createAssistantsCommand } from '../assistants/index.js';
import { printDryRunFooter } from './dry-run.js';

export type DryRunTier = 1 | 2 | 3;

export interface DryRunRegistration {
  /** Factory for the top-level command the path belongs to. */
  factory: () => Command;
  /** Subcommand path below the top-level command (`''` = the command itself). */
  subcommandPath: string;
  tier: DryRunTier;
}

const DRY_RUN_OPTION = '--dry-run';
const DRY_RUN_DESCRIPTION = 'Preview actions without changing anything';

/**
 * The dry-run registration table. Every user-facing command root appears here;
 * subcommand rows exist only where the tier differs from the parent.
 */
export const DRY_RUN_REGISTRATIONS: DryRunRegistration[] = [
  // ── Tier 1: first-delivery previews ───────────────────────────────────────
  { factory: createInstallCommand, subcommandPath: '', tier: 1 },
  { factory: createUninstallCommand, subcommandPath: '', tier: 1 },
  { factory: createSetupCommand, subcommandPath: '', tier: 1 },
  { factory: createSetupCommand, subcommandPath: 'assistants', tier: 1 },
  { factory: createSetupCommand, subcommandPath: 'skills', tier: 1 },
  // `profile` with no subcommand lists profiles (read-only); only the mutating
  // subcommands are first-delivery previews.
  { factory: createProfileCommand, subcommandPath: '', tier: 2 },
  { factory: createProfileCommand, subcommandPath: 'login', tier: 1 },
  { factory: createProfileCommand, subcommandPath: 'logout', tier: 1 },
  { factory: createProfileCommand, subcommandPath: 'refresh', tier: 1 },
  { factory: createProfileCommand, subcommandPath: 'switch', tier: 1 },
  { factory: createProfileCommand, subcommandPath: 'delete', tier: 1 },
  { factory: createProfileCommand, subcommandPath: 'rename', tier: 1 },
  // `profile status` is a would-sign-in describe command (option B): on invalid
  // auth it describes the re-authentication it would start; it is not read-only
  // tier 2, so no "Nothing to preview" footer ever prints for it.
  { factory: createProfileCommand, subcommandPath: 'status', tier: 1 },
  // `proxy` is mostly process mutation (start/stop/restart/analytics); only
  // connect/disconnect are first-delivery previews and status/inspect are
  // read-only.
  { factory: createProxyCommand, subcommandPath: '', tier: 3 },
  { factory: createProxyCommand, subcommandPath: 'connect', tier: 1 },
  { factory: createProxyCommand, subcommandPath: 'connect desktop', tier: 1 },
  { factory: createProxyCommand, subcommandPath: 'connect vscode', tier: 1 },
  { factory: createProxyCommand, subcommandPath: 'disconnect', tier: 1 },
  { factory: createProxyCommand, subcommandPath: 'status', tier: 2 },
  { factory: createProxyCommand, subcommandPath: 'inspect', tier: 2 },
  { factory: createProxyCommand, subcommandPath: 'analytics status', tier: 2 },
  // `docs` with no subcommand lists tools (read-only).
  { factory: createDocsCommand, subcommandPath: '', tier: 2 },
  { factory: createDocsCommand, subcommandPath: 'list', tier: 2 },
  { factory: createDocsCommand, subcommandPath: 'install', tier: 1 },
  { factory: createDocsCommand, subcommandPath: 'uninstall', tier: 3 },
  { factory: createDocsCommand, subcommandPath: 'init', tier: 3 },

  // ── Tier 2: read-only commands ─────────────────────────────────────────────
  { factory: createListCommand, subcommandPath: '', tier: 2 },
  { factory: createVersionCommand, subcommandPath: '', tier: 2 },
  { factory: createDoctorCommand, subcommandPath: '', tier: 2 },
  { factory: createModelsCommand, subcommandPath: '', tier: 2 },
  { factory: createSoundCommand, subcommandPath: '', tier: 2 },
  { factory: createTipsCommand, subcommandPath: '', tier: 2 },
  { factory: createWhatsnewCommand, subcommandPath: '', tier: 2 },
  { factory: createPluginCommand, subcommandPath: '', tier: 3 },
  { factory: createPluginCommand, subcommandPath: 'list', tier: 2 },
  { factory: createSkillsCommand, subcommandPath: '', tier: 3 },
  { factory: createSkillsCommand, subcommandPath: 'list', tier: 2 },
  { factory: createSkillsCommand, subcommandPath: 'find', tier: 2 },
  { factory: createMcpCommand, subcommandPath: '', tier: 3 },
  { factory: createMcpCommand, subcommandPath: 'list', tier: 2 },
  { factory: createCodebaseCommand, subcommandPath: '', tier: 3 },
  { factory: createCodebaseCommand, subcommandPath: 'status', tier: 2 },
  { factory: createCodebaseCommand, subcommandPath: 'open', tier: 2 },

  // ── Tier 3: mutating commands that are not previewable yet ─────────────────
  { factory: createUpdateCommand, subcommandPath: '', tier: 3 },
  { factory: createSelfUpdateCommand, subcommandPath: '', tier: 3 },
  { factory: createAnalyticsCommand, subcommandPath: '', tier: 3 },
  { factory: createAssistantsCommand, subcommandPath: '', tier: 3 },
  // `sdk` reads by default only for its list/get/export commands; every write
  // exits at the SDK service layer, so tier-3 is the safe default.
  { factory: createSdkCommand, subcommandPath: '', tier: 3 },
  { factory: createSdkCommand, subcommandPath: 'assistants list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'assistants get', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'assistants get-tools', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'assistant-categories list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'assistant-categories get', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'datasources list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'datasources get', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'integrations list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'integrations get', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'integrations get-by-alias', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'llm list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills get', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills export', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills list-assistant-skills', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills get-assistants', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills list-categories', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'skills get-users', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'users me', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'users data', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'workflows list', tier: 2 },
  { factory: createSdkCommand, subcommandPath: 'workflows get', tier: 2 },
];

/** Normalises `profile/login`, `profile login` and ` profile  login ` alike. */
function normalizePath(path: string): string {
  return path
    .trim()
    .split(/[\s/]+/)
    .filter(Boolean)
    .join(' ');
}

let tierLookup: Map<string, DryRunTier> | undefined;

/**
 * Builds (once) the absolute-path → tier map. A factory is instantiated only to
 * read its command name; the command tree used at runtime is the one built by
 * `buildProgram()`.
 */
function getTierLookup(): Map<string, DryRunTier> {
  if (!tierLookup) {
    tierLookup = new Map<string, DryRunTier>();
    for (const registration of DRY_RUN_REGISTRATIONS) {
      const rootName = registration.factory().name();
      const path = normalizePath([rootName, registration.subcommandPath].join(' '));
      tierLookup.set(path, registration.tier);
    }
  }
  return tierLookup;
}

/**
 * Resolves the tier for a command path (`profile login`, `sdk/skills/create`),
 * inheriting the nearest registered ancestor. Returns `undefined` for command
 * paths that are absent from the table (tool-invoked and legacy commands).
 */
export function resolveDryRunTier(path: string): DryRunTier | undefined {
  const segments = normalizePath(path).split(' ').filter(Boolean);
  const lookup = getTierLookup();

  while (segments.length > 0) {
    const tier = lookup.get(segments.join(' '));
    if (tier !== undefined) {
      return tier;
    }
    segments.pop();
  }

  return undefined;
}

interface ActionHandlerInternals {
  /** Commander 11 stores the registered action listener here. */
  _actionHandler: ((args: unknown[]) => unknown) | null;
}

/**
 * Wraps a command's action so tier-2 prints its footer before running the real
 * action and tier-3 prints its footer without running it. Tier-1 is never
 * wrapped: the command's own planner owns the preview.
 */
function wrapAction(command: Command, tier: 2 | 3): void {
  const internals = command as unknown as ActionHandlerInternals;
  const original = internals._actionHandler;
  if (typeof original !== 'function') {
    return;
  }

  internals._actionHandler = (args: unknown[]) => {
    const options = command.optsWithGlobals() as { dryRun?: boolean };
    if (!options.dryRun) {
      return original(args);
    }

    printDryRunFooter(tier);
    if (tier === 3) {
      process.exitCode = 0;
      return undefined;
    }
    return original(args);
  };
}

function decorate(command: Command, tier: DryRunTier): void {
  if (!command.options.some((option) => option.long === DRY_RUN_OPTION)) {
    command.option(DRY_RUN_OPTION, DRY_RUN_DESCRIPTION);
  }

  if (tier === 1) {
    // Pass-through: the first-delivery commands build their own preview plan.
    return;
  }

  wrapAction(command, tier);
}

function applyToSubtree(command: Command, path: string): void {
  const tier = resolveDryRunTier(path);
  if (tier === undefined) {
    return;
  }

  decorate(command, tier);

  for (const child of command.commands) {
    applyToSubtree(child, `${path} ${child.name()}`);
  }
}

/**
 * Registers the shared `--dry-run` option (and tier-2/tier-3 action wrappers) on
 * every user-facing command of a built program.
 */
export function registerDryRunFlags(program: Command): void {
  for (const command of program.commands) {
    applyToSubtree(command, command.name());
  }
}
