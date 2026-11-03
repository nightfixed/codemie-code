/**
 * dry-run registration — pins the CLI-wide `--dry-run` surface:
 *
 *  - every user-facing command and subcommand accepts `--dry-run`
 *  - tool-invoked commands (`hook`, `opencode-metrics`, `mcp-proxy`) still reject it
 *  - tier-1 (first-delivery previews) passes through to the command's own planner
 *  - tier-2 (read-only) prints the read-only footer and then runs normally
 *  - tier-3 (mutating, not yet previewable) prints the footer and never runs the action
 *
 * The program is built through `buildProgram()` so no start-up side effects
 * (migrations, update checks, first-time experience, `program.parse`) run here.
 * Registry/framework/process dependencies are mocked so no test touches the
 * developer's real ~/.codemie, network, npm or spawned processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Command } from 'commander';

// ---------------------------------------------------------------------------
// Shared mocks (hoisted so vi.mock factories can reference them safely).
// ---------------------------------------------------------------------------

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getLogFilePath: vi.fn(() => undefined),
  },
}));

const registryMock = vi.hoisted(() => ({
  getManageableAgents: vi.fn(() => []),
  getInstalledAgents: vi.fn(async () => []),
  getAgent: vi.fn(() => undefined),
}));
vi.mock('@/agents/registry.js', () => ({ AgentRegistry: registryMock }));

const frameworksMock = vi.hoisted(() => ({
  getAllFrameworks: vi.fn(() => []),
  getFrameworksByGroup: vi.fn(() => []),
  getFramework: vi.fn(() => undefined),
}));
vi.mock('@/frameworks/index.js', () => ({ FrameworkRegistry: frameworksMock }));

const processesMock = vi.hoisted(() => ({
  getLatestVersion: vi.fn(async () => undefined),
  installGlobal: vi.fn(async () => {}),
  getCommandPath: vi.fn(async () => undefined),
  commandExists: vi.fn(async () => false),
}));
vi.mock('@/utils/processes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/processes.js')>();
  return { ...actual, ...processesMock };
});

vi.mock('@/utils/cli-bin.js', () => ({ restoreCliBinLink: vi.fn(async () => {}) }));

const spinner = {
  start: vi.fn(() => spinner),
  succeed: vi.fn(() => spinner),
  warn: vi.fn(() => spinner),
  fail: vi.fn(() => spinner),
  stop: vi.fn(() => spinner),
  info: vi.fn(() => spinner),
};
vi.mock('ora', () => ({ default: vi.fn(() => spinner) }));

const metricsMock = vi.hoisted(() => ({
  sendMetric: vi.fn(),
  MetricsSender: vi.fn(),
}));
vi.mock('@/providers/plugins/sso/session/processors/metrics/metrics-api-client.js', () => metricsMock);

import { buildProgram } from '@/cli/program.js';
import {
  registerDryRunFlags,
  resolveDryRunTier,
} from '@/cli/commands/shared/dry-run-registration.js';
import { restoreCliBinLink } from '@/utils/cli-bin.js';
import { buildSetupPlan } from '../setup.js';
import type { ProviderSetupSteps } from '@/providers/index.js';
import { ConfigLoader } from '@/utils/config.js';
import { ProviderRegistry } from '@/providers/core/registry.js';

// ---------------------------------------------------------------------------
// Constants and helpers.
// ---------------------------------------------------------------------------

const TIER_2_FOOTER = 'Nothing to preview — this command does not modify anything.';
const TIER_3_FOOTER = 'Dry run is not available for this command yet; nothing was changed.';

const LEGACY_DRY_RUN = new Set(['skill', 'log', 'workflow', 'test-metrics']);
const TOOL_INVOKED = new Set(['hook', 'opencode-metrics', 'mcp-proxy']);

interface CommandInternals {
  _actionHandler: ((args: unknown[]) => unknown) | null;
}

interface CapturedIo {
  output: () => string;
  errors: () => string;
  restore: () => void;
}

function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  const toString = (chunk: unknown): string => (typeof chunk === 'string' ? chunk : String(chunk));

  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    out.push(toString(chunk));
    return true;
  }) as typeof process.stdout.write);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    err.push(toString(chunk));
    return true;
  }) as typeof process.stderr.write);
  // Vitest replaces the global console, so console output never reaches the
  // stream spies above; capture it separately into the same buffers.
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(`${args.map(toString).join(' ')}\n`);
  });
  const errorLogSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    err.push(`${args.map(toString).join(' ')}\n`);
  });

  return {
    output: () => out.join(''),
    errors: () => err.join(''),
    restore: () => {
      logSpy.mockRestore();
      errorLogSpy.mockRestore();
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** Replaces every action with a no-op so a parse can never perform real work. */
function neutralizeActions(command: Command): void {
  (command as unknown as CommandInternals)._actionHandler = () => {};
  for (const child of command.commands) {
    neutralizeActions(child);
  }
}

/** Commander's exitOverride is copied when a subcommand is added, so set it on every node. */
function overrideExits(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) {
    overrideExits(child);
  }
}

function collectPaths(
  command: Command,
  parents: string[] = []
): Array<{ path: string; command: Command }> {
  const path = [...parents, command.name()];
  const collected = [{ path: path.join(' '), command }];
  for (const child of command.commands) {
    collected.push(...collectPaths(child, path));
  }
  return collected;
}

function findCommand(program: Command, path: string): Command | undefined {
  let current: Command | undefined = program;
  for (const segment of path.split(' ').filter(Boolean)) {
    current = current?.commands.find((candidate) => candidate.name() === segment);
    if (!current) {
      return undefined;
    }
  }
  return current;
}

function freshProgram(): Command {
  const program = buildProgram();
  overrideExits(program);
  registerDryRunFlags(program);
  return program;
}

async function parse(program: Command, argv: string[]): Promise<void> {
  await program.parseAsync(['node', 'codemie', ...argv]);
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

let io: CapturedIo;
let previousExitCode: number | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  previousExitCode = process.exitCode;
  io = captureIo();
});

afterEach(() => {
  io.restore();
  process.exitCode = previousExitCode;
});

describe('registerDryRunFlags', () => {
  it('registers --dry-run on every user-facing command and subcommand', () => {
    const program = freshProgram();

    const missing: string[] = [];
    for (const top of program.commands) {
      if (LEGACY_DRY_RUN.has(top.name()) || TOOL_INVOKED.has(top.name())) {
        continue;
      }
      for (const { path, command } of collectPaths(top)) {
        if (!command.options.some((option) => option.long === '--dry-run')) {
          missing.push(path);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('keeps --dry-run unknown for tool-invoked commands', async () => {
    const program = freshProgram();

    for (const name of TOOL_INVOKED) {
      const command = findCommand(program, name);
      expect(command, name).toBeDefined();
      expect(
        command?.options.some((option) => option.long === '--dry-run'),
        `${name} must not register --dry-run`
      ).toBe(false);
    }

    const toolArgs: Record<string, string[]> = {
      hook: ['hook', '--dry-run'],
      'opencode-metrics': ['opencode-metrics', '--dry-run'],
      'mcp-proxy': ['mcp-proxy', 'https://example.com/mcp', '--dry-run'],
    };

    const neutralized = freshProgram();
    neutralizeActions(neutralized);
    for (const name of TOOL_INVOKED) {
      await expect(parse(neutralized, toolArgs[name])).rejects.toThrow(/unknown option '--dry-run'/);
    }
  });

  it('accepts --dry-run on the first-delivery and read-only commands without an unknown-option error', async () => {
    const program = freshProgram();
    neutralizeActions(program);

    const argvList = [
      ['install', '--dry-run'],
      ['setup', '--dry-run'],
      ['profile', '--dry-run'],
      ['proxy', 'status', '--dry-run'],
      ['docs', '--dry-run'],
      ['list', '--dry-run'],
      ['profile', 'login', '--dry-run'],
      ['docs', 'install', 'codegraph', '--dry-run'],
    ];

    for (const argv of argvList) {
      await expect(parse(program, argv), argv.join(' ')).resolves.toBeUndefined();
    }
  });

  it('passes tier-1 execution through to the command own action', async () => {
    const program = freshProgram();

    await parse(program, ['install', '--dry-run']);

    expect(registryMock.getManageableAgents).toHaveBeenCalled();
    expect(io.output()).not.toContain(TIER_2_FOOTER);
    expect(io.output()).not.toContain(TIER_3_FOOTER);
  });

  it('prints the read-only footer and then runs tier-2 commands normally', async () => {
    const program = freshProgram();

    await parse(program, ['version', '--dry-run']);

    expect(io.output().startsWith(TIER_2_FOOTER)).toBe(true);
    expect(io.output()).toContain('AI/Run CodeMie CLI v');
  });

  it('prints the tier-3 footer and does not run the command action', async () => {
    const program = freshProgram();

    await parse(program, ['update', '--dry-run']);

    expect(io.output().trim()).toBe(TIER_3_FOOTER);
    expect(registryMock.getManageableAgents).not.toHaveBeenCalled();
    expect(processesMock.getLatestVersion).not.toHaveBeenCalled();
  });

  it('classifies representative paths into the expected tiers', () => {
    const expectations: Array<[string, 1 | 2 | 3]> = [
      ['install', 1],
      ['uninstall', 1],
      ['setup', 1],
      ['setup skills', 1],
      ['profile login', 1],
      ['profile rename', 1],
      ['proxy connect', 1],
      ['proxy connect desktop', 1],
      ['proxy disconnect', 1],
      ['docs install', 1],
      ['docs uninstall', 3],
      ['profile', 2],
      ['profile status', 1],
      ['docs', 2],
      ['docs list', 2],
      ['proxy status', 2],
      ['proxy analytics status', 2],
      ['plugin list', 2],
      ['skills list', 2],
      ['skills find', 2],
      ['mcp list', 2],
      ['codebase status', 2],
      ['sdk skills list', 2],
      ['update', 3],
      ['self-update', 3],
      ['plugin install', 3],
      ['skills add', 3],
      ['mcp remove', 3],
      ['sdk skills create', 3],
      ['sdk workflows create file', 3],
      ['docs init', 3],
      ['assistants chat', 3],
    ];

    for (const [path, tier] of expectations) {
      expect(resolveDryRunTier(path), path).toBe(tier);
    }
    expect(resolveDryRunTier('hook')).toBeUndefined();
    expect(resolveDryRunTier('opencode-metrics')).toBeUndefined();
    expect(resolveDryRunTier('mcp-proxy')).toBeUndefined();
  });

  it('every registered path resolves to a real command with the flag', () => {
    const program = freshProgram();
    const expectations: string[] = [
      'install',
      'uninstall',
      'setup',
      'profile',
      'profile login',
      'profile logout',
      'profile refresh',
      'profile switch',
      'profile delete',
      'profile rename',
      'profile status',
      'proxy',
      'proxy connect',
      'proxy connect desktop',
      'proxy connect vscode',
      'proxy disconnect',
      'proxy status',
      'docs',
      'docs list',
      'docs install',
      'docs init',
      'list',
      'version',
      'doctor',
      'models',
      'models list',
      'sound',
      'tips',
      'whatsnew',
      'update',
      'self-update',
      'plugin',
      'plugin list',
      'analytics',
      'analytics otel',
      'codebase',
      'codebase status',
      'skills',
      'skills add',
      'skills list',
      'mcp',
      'mcp add',
      'mcp list',
      'assistants',
      'assistants chat',
      'sdk',
      'sdk skills create',
    ];

    for (const path of expectations) {
      const command = findCommand(program, path);
      expect(command, path).toBeDefined();
      expect(
        command?.options.some((option) => option.long === '--dry-run'),
        path
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Side-effect freedom: the tier-1 planners describe mutations and must never
// invoke the real mutators (install/uninstall/switch/etc.) or emit analytics.
// ---------------------------------------------------------------------------

describe('tier-1 dry-run planners never apply mutations', () => {
  it('install --dry-run describes the agent without installing or restoring the bin link', async () => {
    const program = freshProgram();
    const install = vi.fn(async () => {});
    registryMock.getAgent.mockReturnValue({
      name: 'acme',
      displayName: 'Acme',
      describeInstall: () => [{ kind: 'install', label: 'install acme', targets: ['acme'] }],
      install,
    });

    await parse(program, ['install', 'acme', '--dry-run']);

    expect(registryMock.getAgent).toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(processesMock.installGlobal).not.toHaveBeenCalled();
    expect(vi.mocked(restoreCliBinLink)).not.toHaveBeenCalled();
    expect(io.output()).toContain('install acme');
  });

  it('uninstall --dry-run describes the agent without uninstalling it', async () => {
    const program = freshProgram();
    const uninstall = vi.fn(async () => {});
    registryMock.getAgent.mockReturnValue({
      name: 'acme',
      displayName: 'Acme',
      describeUninstall: () => [{ kind: 'remove', label: 'remove acme', targets: ['acme'] }],
      uninstall,
    });

    await parse(program, ['uninstall', 'acme', '--dry-run']);

    expect(uninstall).not.toHaveBeenCalled();
    expect(io.output()).toContain('remove acme');
  });

  it('no tier-1 planner reaches the metrics pipeline', async () => {
    const program = freshProgram();
    registryMock.getAgent.mockReturnValue({
      name: 'acme',
      displayName: 'Acme',
      describeInstall: () => [{ kind: 'install', label: 'install acme', targets: ['acme'] }],
      install: vi.fn(),
    });

    await parse(program, ['install', 'acme', '--dry-run']);
    await parse(program, ['uninstall', 'acme', '--dry-run']);

    expect(metricsMock.sendMetric).not.toHaveBeenCalled();
  });

  it('install --dry-run catches a throwing describe and still prints the failure end-cap', async () => {
    const originalArgv = [...process.argv];
    process.argv = ['node', 'codemie', 'install', 'acme', '--dry-run'];
    try {
      const program = freshProgram();
      registryMock.getAgent.mockReturnValue({
        name: 'acme',
        displayName: 'Acme',
        describeInstall: () => {
          throw new Error('boom');
        },
      });

      await parse(program, ['install', 'acme', '--dry-run']);

      expect(process.exitCode).toBe(1);
      expect(io.errors()).toContain('Installation failed');
      expect(io.output()).toContain('Nothing was changed.');
    } finally {
      process.argv = [...originalArgv];
    }
  });
});

describe('buildSetupPlan credential questions (AC4)', () => {
  const steps = {
    describeCredentialSideEffects: () => [],
  } as unknown as ProviderSetupSteps;

  it('describes sign-in instead of asking when no credential answers were gathered', () => {
    const plan = buildSetupPlan('ai-run-sso', steps, 'p', false, 'global');

    expect(JSON.stringify(plan)).toContain('would prompt for ai-run-sso credentials');
    expect(JSON.stringify(plan)).not.toContain('with the credentials you provided');
  });

  it('previews the gathered answers instead of "would prompt" when credentials are present', () => {
    const plan = buildSetupPlan('litellm', steps, 'p', false, 'global', {
      baseUrl: 'http://proxy.example.com',
      apiKey: 'sk-live',
    });

    expect(JSON.stringify(plan)).toContain(
      'would configure litellm with the credentials you provided'
    );
    expect(JSON.stringify(plan)).not.toContain('would prompt for litellm credentials');
    expect(JSON.stringify(plan)).toContain('apiKey (stored, masked)');
  });
});

describe('profile status would-sign-in describe (CR-006 option B)', () => {
  it('describes the would-be re-auth on invalid auth and never prints the read-only footer', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    const originalArgv = [...process.argv];
    process.argv = ['node', 'codemie', 'profile', 'status', '--dry-run'];

    const loadSpy = vi.spyOn(ConfigLoader, 'load').mockResolvedValue({
      provider: 'ai-run-sso',
      codeMieUrl: 'https://codemie.example.com',
    });
    const listSpy = vi.spyOn(ConfigLoader, 'listProfiles').mockResolvedValue([
      { name: 'p', active: true, profile: { provider: 'ai-run-sso' }, source: 'global' },
    ]);
    const activeSpy = vi.spyOn(ConfigLoader, 'getActiveProfileName').mockResolvedValue('p');
    const localSpy = vi.spyOn(ConfigLoader, 'hasLocalConfig').mockResolvedValue(false);
    const providerSpy = vi.spyOn(ProviderRegistry, 'getProvider').mockReturnValue({
      name: 'ai-run-sso',
    });
    const stepsSpy = vi.spyOn(ProviderRegistry, 'getSetupSteps').mockReturnValue({
      validateAuth: async () => ({ valid: false }),
    });

    try {
      const program = freshProgram();
      await parse(program, ['profile', 'status', '--dry-run']);

      expect(io.output()).toContain('would re-authenticate');
      expect(io.output()).not.toContain('Nothing to preview');
    } finally {
      process.argv = [...originalArgv];
      process.exitCode = previousExitCode;
      loadSpy.mockRestore();
      listSpy.mockRestore();
      activeSpy.mockRestore();
      localSpy.mockRestore();
      providerSpy.mockRestore();
      stepsSpy.mockRestore();
    }
  });
});
