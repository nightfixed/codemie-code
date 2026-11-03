# EPMCDME-16643 — Dry-Run Previews for User-Facing CLI Commands

## Intent

Give every command a human types at the `codemie` shell a consistent `--dry-run`
that previews exactly what the command would do — the planned actions and where
they would apply — and guarantees nothing changes. The first delivery covers
install/uninstall, setup, profile, proxy connect/disconnect (client
configuration), and docs install. This is CLI-only: dry-run inside agent chat
sessions is out of scope.

## Why

The codebase already has dry-run in four ad-hoc places (`skill sync`
src/cli/commands/skill.ts:210, `log clean` src/cli/commands/log/index.ts:143,
`workflow` src/cli/commands/workflow.ts:156, `test-metrics`
src/cli/commands/test-metrics.ts:32), each with divergent wording and no shared
"nothing was changed" guarantee (that text exists nowhere today). The ticket
makes the concept uniform so users can safely preview destructive or
credential-storing commands.

## Preview plan model

The preview is a first-class, typed plan object — not ad-hoc strings. Every
first-delivery command fills a `PlannedAction[]`, where each action names what
it is, what it would do, and where:

```ts
type PlanKind = 'write-file' | 'remove' | 'install' | 'exec'
             | 'start-process' | 'stop-process' | 'store-credential' | 'network';

interface PlannedAction {
  kind: PlanKind;      // the class of effect
  label: string;       // plain-language action sentence
  targets: string[];   // files / bin links / config entries / commands it would touch
}
```

The final rendered output appends every action's `label` and `targets`, then
the single end-cap line **"Nothing was changed."**

## Behavior — three tiers

Every user-facing command accepts `--dry-run` without Commander's unknown-option
error (Commander rejects undeclared options by default; src/cli/index.ts:6).
The classification is a **data-driven table keyed by `<subcommand path>`**
(e.g. `profile/login` vs `profile/status` vs `skill/sync`), consulted by a
registration loop over a list of `{factory, subcommandPath, tier}`. The loop
adds the shared `--dry-run` option to every user-facing command **except** the
four legacy preview factories (`skill sync`, `log clean`, `workflow`,
`test-metrics`), which already declare it; worker unification moves them onto the
shared declaration in the named follow-up. The tool-invoked commands — `hook`,
`opencode-metrics`, `mcp-proxy`, and the `proxy-daemon` binary (a separate
Commander parser, src/bin/proxy-daemon.ts) — are absent from the table and
retain existing behavior.

1. **Preview (first delivery).** `install`/`uninstall`
   (src/cli/commands/install.ts, uninstall.ts), `setup` (setup.ts), the mutating
   `profile` subcommands login/logout/refresh/switch/delete/rename
   (profile/index.ts:37-43, auth.ts:14,125-148), `proxy connect`/`disconnect`
   (proxy/index.ts:286-372), and `docs install` (docs.ts:42-58) each print the
   `PlannedAction[]` described below, ending with "Nothing was changed." The four
   legacy previews are already tier-1 and receive the same footer this delivery.

2. **Read-only.** `list`, `version`, `doctor`, `models`, and other read-only
   commands (`docs list`, bare `profile` list) run exactly as normal and append:
   *"Nothing to preview — this command does not modify anything."* `profile
   status` runs its read-only `validateAuth`, but on invalid auth it does **not**
   re-authenticate (see Guarantees).

3. **Accept-but-unavailable.** Remaining user-facing mutating commands (e.g.
   `update`, `self-update`, `plugin`, `analytics`, `codebase`, `docs init`)
   accept the flag, do not run, print *"Dry run is not available for this command
   yet; nothing was changed."* and exit with the **success** status for a valid
   invocation. Argument or option errors yield their normal error and failure
   status. Full previews for these are deferred by AC9.

## Guarantees (every dry run)

- No file or configuration writes, nothing installed or removed, no
  background-process start/stop, no credential storage.
- **Start-up is fully covered.** A single raw-argv predicate
  `isDryRunInvocation(argv)` — shared by bin/codemie.js and the CLI and aware of
  `--task <task>` (flag consumed as the task string), `--dry-run=false`, and the
  `--` positional delimiter — runs before Commander parses. When true, the
  start-up path (bin/codemie.js:35-84) skips `MigrationRunner.runPending`,
  `checkAndPromptForUpdate`, **and** `showUpgradeNotice` (so `markVersionSeen`
  never writes the last-seen-version marker to ~/.codemie; whatsnew.ts:157-165).
- **The setup wizard asks but does not apply.** The credential prompt
  (`getCredentials`) is **asked** (the questions keep coming, per AC4), but its
  mutating branches are never run: Bedrock's `createAwsProfile` (`~/.aws` write)
  and SSO's `authenticateWithCodeMie` (browser/server sign-in) are described as
  would-do actions instead of executed. Because no authenticated session exists,
  the preview names the model list from a non-authenticated catalog where the
  provider offers one; otherwise it states *"would configure <provider> — model
  list requires sign-in"* as a planned step and claims no model it cannot resolve.
  `fetchModels`/`installModel`, `saveUserEmail`,
  `saveProfile`/`initProjectConfig`/`switchProfile`, and `checkAndInstallClaude`
  are all suppressed and described (setup.ts:229-397).
- **Sign-in is described, never started.** `profile login` (auth.ts:14),
  `profile refresh` (clears stored credentials then re-launches sign-in,
  auth.ts:125-148), and `profile status`'s invalid-auth branch (`validateAuth`
  reads but `promptForReauth`/`authenticate`, profile/index.ts:105-151,
  auth-validation.ts:34-35, are suppressed and described as *"would
  re-authenticate"*) never start sign-in or store a credential under `--dry-run`.
- **Pre-flight validation is read-only and parity-true.** A dry run performs the
  read-only preconditions (e.g. SSO-credential presence via
  `getStoredPlatformCredentials`, `baseUrl`/`codeMieUrl` presence) without side
  effects and reports the real run's would-be validation status — a missing
  credential is reported as *"would fail: no SSO credentials"* with the failure
  status and footer (AC8), never as a would-succeed plan.
- Network lookups needed for an accurate preview are allowed and run under a
  shared timeout budget; analytics or other outbound data submission, credential
  storage, and server-side changes are not. Suppression threads a dry-run gate
  from the CLI to the metrics/session pipeline (reusing the `dryRun` switch in
  metrics-api-client.ts:311-607). During implementation, verify whether
  install/setup/docs emit analytics; if they do, wire the gate, else record the
  per-command negative statement.
- **The end-cap prints once.** One helper module owns the three footer strings.
  It prints via an explicit call on the success path; a `process.on('exit')`
  handler is the failure-path fallback, registered only for dry-run invocations
  and gated by a printed-once flag — so it never double-prints and never fires for
  a non-`--dry-run` command. Failure paths convert `process.exit(1)` →
  `process.exitCode = 1` across install.ts, uninstall.ts:168,173, setup.ts:45,
  profile/index.ts, **and proxy** (printProxyError and verifySsoCredentials in
  connect-orchestrator.ts:297-303,325), so the footer prints before a non-zero
  exit.

## First-delivery planning surfaces

**Command-level planner.** Planning lives at the command level, not only on
adapters. `install`/`uninstall` build the plan by concatenating the adapter's
`describeInstall()`/`describeUninstall()` with the command's own effects:
`restoreCliBinLink()` (global `codemie` symlink rewrite, install.ts:194),
`additionalInstallation()` (sounds/plugin bundle, install.ts:137,166,221), and
the `statusline` path (install.ts:294-318) — which has no adapter — described
as a statusline-script write. A general command-level `buildPreviewPlan()` hook
is the home for future non-adapter mutators as they graduate from tier-3.

`describeInstall()`/`describeUninstall()` are **abstract** on
`BaseAgentAdapter`/`BaseFrameworkAdapter` and **mandatory** for every adapter
reachable from install/uninstall/docs install this delivery. `describeInit()` is
not declared this delivery (`docs init` is tier-3); it returns, with its
`agentName` parameter, when `docs init` graduates. There is no version-only
fallback — an adapter without `describeInstall()` fails to compile, so a
first-delivery preview can never silently under-report.

**Proxy (orchestrator level).** A dry run never enters
`connectTargets`/`ensureDaemon`/`verifySsoCredentials`
(connect-orchestrator.ts). `describeConnect()` enumerates the full connect
sequence as planned actions it then does not execute: verify SSO credentials
(read-only; reports would-be failure), sync skills (list target SKILL.md files,
no network fetch or write), install the Claude plugin bundle (list
`~/.claude/skills/` writes), ensure the daemon — including the
`--force`/mismatch/unhealthy stop-first branch (a
`stop-process`/`start-process` pair, never executed) — store the gateway key
(`store-credential`, not written), and **all seven writers**: `runClaudeDesktop`
(MCP servers), `runVscodeByok` (`chatLanguageModels.json`), `runVscodeClaudeCode`
(`settings.json`), `runCodexDesktop` (`~/.codex/config.toml`), `runClaudeCodeOtlp`
(`~/.claude/settings.json`), `runCopilotChatOtlp` (hook file + VS Code
`settings.json`), `runCopilotCliOtlp` (hook file) —
connect-orchestrator.ts:905-934. `describeDisconnect()` enumerates the
removal-only path — `removeCodexDesktopConfig`, `removeClaudeCodeOtlpConfig`,
`removeCopilotChatOtlpConfig`, `removeCopilotCliOtlpConfig`
(disconnect-orchestrator.ts:153-175) — and states the daemon is never touched.

For `--codex-desktop`, the preview names the pinned model slug when `--model`
is explicit, and otherwise states "would select the best available model" — the
pin is only computable against the daemon's minted key, which a dry run never
creates.

**Timeouts.** `describeInstall`/`describeConnect` lookups (including
`fetchManagedMcpServers` and the connector describe seams) run under the same
shared `Promise.race`/`AbortSignal.timeout` budget, preferring static registry
metadata over spawning `--version` processes.

## Acceptance criteria

1. Every user-facing CLI command accepts `--dry-run` without an unknown-option
   error; `hook`, `opencode-metrics`, `mcp-proxy`, and the proxy daemon do not
   offer the flag and keep existing behavior.
2. install/uninstall, setup, profile, proxy connect/disconnect, and docs install
   each print a typed, command-level `PlannedAction[]` — full action list and
   where each would apply — ending with "nothing was changed."
3. A dry run writes no files or config (including start-up migrations and the
   what's-new marker), installs/removes nothing, starts/stops no background
   process, and stores no credentials.
4. Prompting commands still ask, then preview the result without applying it — for
   `setup`, credential questions are asked but `createAwsProfile`/server sign-in
   and the other mutation steps are described, not executed; no unverifiable model
   is claimed.
5. Read-only commands (list, version, doctor, models, …) run normally with a
   short "nothing to preview" note; `profile status` reads auth but does not
   re-authenticate.
6. Preview-accuracy network lookups (timeout-bounded) are permitted; analytics
   outbound, credential storage, and server-side changes are not.
7. A would-sign-in command (login, refresh, or status's re-auth branch) describes
   the action without starting sign-in or storing a credential.
8. A would-succeed dry run returns the success status — including a credless
   `proxy connect` would **fail** (error status + footer), not succeed; invalid or
   unsupported input returns the applicable error and failure status with the
   footer reachable on failure.
9. Out of scope: full previews for mutating commands outside the first delivery,
   machine-readable preview output, agent-chat dry runs.

## Decisions

- `config` in AC2 maps to `proxy connect`/`disconnect` (the client-config
  surface), superseding the story's deferred-proxy scope — user
- Typed `PlannedAction` model (kind + label + targets) over ad-hoc strings
- Planning lives at the **command** level (adapter `describe*` concatenated with
  the command's own effects: bin-link restore, additional-installation,
  statusline), over adapter-only planning — closes AR-15
- `describeInstall()`/`describeUninstall()` abstract and mandatory for reachable
  adapters; `describeInit()` deferred (no tier-1 consumer); no version-only
  fallback — carries prior AR-10, adjusted by AR-15
- Setup `getCredentials` is asked, never applied: `createAwsProfile`/SSO server
  auth are described-not-executed, and the model list is named from a
  non-authenticated catalog or a "requires sign-in" step, never an unresolved
  model — closes AR-16
- Proxy dry run performs read-only pre-flight validation (`getStoredPlatformCredentials`,
  URL presence) and reports the would-be validation status; a credless connect
  "would fail" with failure status + footer — closes AR-17
- Proxy `describeConnect` lists all seven writers (incl. the three OTLP writes)
  and `describeDisconnect` lists the removal-only path without touching the daemon
  — closes AR-18
- `profile status` reads `validateAuth` but suppresses `promptForReauth`/
  `authenticate` and describes "would re-authenticate" — closes AR-19
- End-cap prints once: explicit call on success + a printed-once-gated,
  dry-run-only exit handler on failure — closes AR-20
- Table key is `<subcommand path>`; registration is data-driven over
  `{factory, subcommandPath, tier}` and skips the four legacy factories that
  already declare the flag — closes AR-21
- IsDryRunInvocation(argv) gate (handling `--task`, `--dry-run=false`, `--`) skips
  migrations/update/markVersionSeen — carries AR-14
- `process.exit(1)` → `process.exitCode = 1` across install/uninstall/setup/profile/proxy
  — carries AR-12
- Codex `--codex-desktop` names an explicit `--model`, else "best available model"
  — carries prior decision
- Timeout-bounded describe lookups, static metadata over `--version` exec —
  carries prior decision

## Non-goals

- Full previews for mutating commands outside the first delivery (tier-3
  "not available yet" note is not a preview); `docs init` preview deferred with
  its `describeInit`+`agentName` work
- Machine-readable (JSON) preview output
- Dry-run inside agent chat sessions (`AgentAdapter.run(..., { dryRun })`,
  src/agents/core/types.ts:753)
- Refactoring the four legacy preview workers onto the shared helper this
  delivery — a named follow-up ticket (migrate the four workers onto the typed
  Plan model + end-cap helper, owned by the CLI-commands maintainer, filed at
  this delivery's handoff) owns that work; only the text footer unifies now
- Changing the config/env-gated dry-run fields (`metrics.dryRun`,
  `session.sync.dryRun`); the argv flag does not consult them
