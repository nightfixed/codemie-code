# EPMCDME-16643 — Dry-Run Previews for User-Facing CLI Commands — Implementation Plan

**Goal:** Give every user-facing `codemie` command a consistent `--dry-run` that prints a typed `PlannedAction[]` preview (with a "Nothing was changed." end-cap) and guarantees no writes, installs, processes, or credential storage; first delivery covers install/uninstall, setup, profile, proxy connect/disconnect, and docs install.

**Architecture:** Planning lives at the command level. Each effect-owner exposes a `describe*` seam that returns `PlannedAction[]` without side effects; command planners concatenate those seams with the command's own effects, print the plan, and exit. A shared `--dry-run` registration loop (data-driven table) and a raw-argv predicate gate start-up effects. Commit per task using the repo's existing Conventional Commits convention.

**Tech Stack:** Commander CLI, TypeScript ES modules, Vitest (only where a task's Test-first line says yes).

**Spec:** `docs/superpowers/tasks/2026-11-03-epmcdme-16643-dry-run-previews/spec.md`

## Global Constraints

- CLI-only; `AgentAdapter.run(..., { dryRun })` agent-chat dry-run is out of scope — do not touch it.
- No machine-readable (JSON) preview output; footer + labels render as plain text.
- Do not change `metrics.dryRun` / `session.sync.dryRun` config/env fields; argv flag never consults them.
- `describeInit()` is not declared this delivery (`docs init` is tier-3).
- Do not refactor the four legacy preview workers onto the typed plan model; only unify their footer text (named follow-up ticket).
- Exact footer copy: `Nothing was changed.` / `Nothing to preview — this command does not modify anything.` / `Dry run is not available for this command yet; nothing was changed.`

## Review Focus

- `--task <string>` (task-flag value), `--dry-run=false`, and the `--` delimiter must parse correctly by the raw predicate — Task 1 test.
- Tool-invoked commands (`hook`, `opencode-metrics`, `mcp-proxy`, `proxy-daemon`) must reject `--dry-run` while user-facing commands accept it — Task 2 test.
- A dry-run setup must never start sign-in for subscription providers (anthropic `runClaudeBrowserLogin`+`authenticateWithCodeMie`, moonshot `authenticateWithCodeMie`) — Task 4 test pins the describe contract.
- Credless `proxy connect --dry-run` reports "would fail" with failure status, never a would-succeed plan — Task 9.
- The end-cap prints exactly once on both success and failure paths — Task 1 helper.

---

```ts
type PlanKind = 'write-file' | 'remove' | 'install' | 'exec'
             | 'start-process' | 'stop-process' | 'store-credential' | 'network';

interface PlannedAction {
  kind: PlanKind;
  label: string;      // plain-language action sentence
  targets: string[];  // files / bin links / config entries / commands it would touch
}
```

### Task 1: Shared dry-run core

**Files:**
- Create: `src/cli/commands/shared/dry-run.ts`
- Test: `src/cli/commands/shared/__tests__/dry-run.test.ts`

**Interfaces:**
- Produces: `type PlanKind`, `interface PlannedAction` (above); `isDryRunInvocation(argv: string[]): boolean`; `printDryRunFooter(tier: 1|2|3): void` (single owner of the three footer strings); `printEndCap(): void` (printed-once end-cap).

- **Test-first: yes — failing test** for `isDryRunInvocation`: asserts `['--dry-run']` and `['install','x','--dry-run']` → true; `['--dry-run=false']`, `['--task','x']`, `['list']`, and `['install','x','--','--dry-run']` → false.

- [ ] **Step 1:** Write `dry-run.test.ts` with those predicate cases; run it — expected FAIL (`isDryRunInvocation` undefined).
- [ ] **Step 2:** Implement the type + `isDryRunInvocation(argv)` in `dry-run.ts`: true when argv contains a bare `--dry-run` token before any `--` delimiter or `--task <value>`; `--dry-run=false` (and `--no-dry-run`) counts as not-a-dry-run.
- [ ] **Step 3:** Implement `printDryRunFooter` (returns the three tier strings verbatim from Global Constraints) and `printEndCap()`: prints "Nothing was changed." on first call; registers a `process.on('exit')` fallback that also prints it, gated by a printed-once flag and only when the process was a dry-run invocation. Run the predicate test — expected PASS.

### Task 2: Startup gating + `--dry-run` registration and tier table

**Files:**
- Modify: `bin/codemie.js:35-84` (startup side-effects); `src/cli/index.ts:6,48,84-112` (program + command factories)
- Test: `src/cli/commands/__tests__/dry-run-registration.test.ts`

**Interfaces:**
- Consumes: `isDryRunInvocation` (Task 1).
- Produces: a registration table `{ factory, subcommandPath, tier }` and a loop that adds `.option('--dry-run', 'Preview actions without changing anything')` to every user-facing command.

- **Test-first: yes — failing test** builds the full Commander program and asserts `install`/`setup`/`profile`/`proxy`/`docs` (and a read-only `list`) parse `--dry-run` without an unknown-option error, while `hook`, `opencode-metrics`, `mcp-proxy` throw on `--dry-run`.

- [ ] **Step 1:** Write the registration test; run — expected FAIL (commands don't yet carry the flag).
- [ ] **Step 2:** In `bin/codemie.js:35-84`, branch on `isDryRunInvocation(process.argv.slice(2))`: when true, skip `MigrationRunner.runPending` (:38), `checkAndPromptForUpdate` (:57), and `showUpgradeNotice` (:72/78) so `markVersionSeen` (whatsnew.ts:157-165) never writes.
- [ ] **Step 3:** In `src/cli/index.ts`, add the table: tier-1 = install/uninstall/setup/mutating profile subcommands/proxy connect+disconnect/docs install; tier-2 read-only = list/version/doctor/models/docs list/bare profile list/profile status; tier-3 = remaining mutating commands (update, self-update, plugin, analytics, codebase, docs init). The loop skips the four legacy factories that already declare the flag (skill.ts:210, log/index.ts:143, workflow.ts:156, test-metrics.ts:32) and the tool-invoked commands. Wire an action wrapper: tier-3 prints the tier-3 footer and exits 0 for a valid invocation (arg/option errors yield their normal failure); tier-2 prints the tier-2 footer then runs normally; tier-1 short-circuits to its Task 6-9 planner. Run test — expected PASS.

### Task 3: `describe*` contracts on adapter/framework bases

**Files:**
- Modify: `src/agents/core/types.ts:750-752` and `src/agents/core/BaseAgentAdapter.ts:184,244`; `src/frameworks/core/types.ts:60-74` and `src/frameworks/core/BaseFrameworkAdapter.ts:90,95`.
- Modify per adapter: the 9 BaseAgentAdapter subclasses (openwiki, codemie-code, opencode, pi, copilot-cli, codex, kimi, claude, gemini — ACP variants inherit) and 5 framework plugins (codegraph, codebase-memory, graphify, speckit, bmad).
- Interface method added: `describeInstall(): PlannedAction[]`, `describeUninstall(): PlannedAction[]` (abstract, mandatory); `describeAdditionalInstallation?(): PlannedAction[]` (optional, default no-op).

**Interfaces:**
- Consumes: `PlannedAction` (Task 1).
- Produces: `describeInstall()`/`describeUninstall()` on `AgentAdapter`/`FrameworkAdapter`; `describeAdditionalInstallation?()` on `AgentAdapter` only.

- **Test-first: no** (pure enumeration methods over existing install bodies; compile-enforced coverage).

- [ ] **Step 1:** Declare `describeInstall(): PlannedAction[]` and `describeUninstall(): PlannedAction[]` as abstract on `BaseAgentAdapter` and `BaseFrameworkAdapter` (and the two interfaces); add `describeAdditionalInstallation?(): PlannedAction[]` to `AgentAdapter` with a no-op default in `BaseAgentAdapter:265`.
- [ ] **Step 2:** Implement both describe methods on each reachable adapter, reading the adapter's existing `install()`/`uninstall()` body and translating the effects into plain-language actions with actual targets. Override `describeAdditionalInstallation` in `ClaudePlugin` (sounds-dir write, claude.plugin.ts:892) and `PiPlugin` (`pi install <pkg>` for three packages, pi.plugin.ts:512) — not a "sounds/plugin bundle" gloss. Understand the code compiles (missing describe* is a compile error, so no silent under-report).

### Task 4: `describeCredentialSideEffects` on ProviderSetupSteps

**Files:**
- Modify: `src/providers/core/types.ts:291-307` (interface); each `src/providers/plugins/*/*.setup-steps.ts` (sso, jwt, litellm, bedrock, ollama, anthropic-subscription, moonshot-subscription).
- Test: `src/providers/core/__tests__/setup-steps-describe.test.ts`

**Interfaces:**
- Consumes: `PlannedAction` (Task 1).
- Produces: `describeCredentialSideEffects(): PlannedAction[]` on `ProviderSetupSteps` — returns the provider's would-be credential/sign-in effects without executing them.

- **Test-first: yes — failing test** asserting each provider's `describeCredentialSideEffects()` returns actions naming its sign-in branch and calls no auth/store spy: anthropic-subscription lists `runClaudeBrowserLogin` + `authenticateWithCodeMie`; moonshot-subscription lists `authenticateWithCodeMie`; bedrock lists `createAwsProfile` (~/.aws); sso lists `authenticateWithCodeMie`.

- [ ] **Step 1:** Write the test (dynamic-import the setup-steps, spy on auth/credential helpers); run — expected FAIL (no describe method).
- [ ] **Step 2:** Add `describeCredentialSideEffects(): PlannedAction[]` to the `ProviderSetupSteps` interface and implement it in all 7 providers: describe-only, `store-credential`/`network` kinds, no execution. Run test — expected PASS.

### Task 5: Proxy connector describe seams

**Files:**
- Modify: the connector writers/removers in `src/cli/commands/proxy/connectors/` (vscode.ts, vscode-claude-code.ts, codex-desktop.ts, claude-code-otlp.ts, copilot-chat-otlp.ts, copilot-cli-otlp.ts, desktop.ts) plus `disconnect-orchestrator.ts:153-175`.

**Interfaces:**
- Consumes: `PlannedAction` (Task 1).
- Produces: `describe(): PlannedAction[]` and `describeRemove(): PlannedAction[]` on each connector, covering the seven write targets (`chatLanguageModels.json`, VS Code `settings.json`, `~/.codex/config.toml`, `~/.claude/settings.json`, the two OTLP hook files, `managed MCP servers`) and the four removal-only paths.

- **Test-first: no** (describe-only enumeration; the seven-vs-four accuracy is pinned by Task 9's routing).

- [ ] **Step 1:** Add `describe()/describeRemove()` to each connector module, mirroring the paths its real writer/remover touches (their `write*`/`remove*` call sites list the exact files), returning describe-only actions.
- [ ] **Step 2:** Ensure removers (`removeCodexDesktopConfig`, `removeClaudeCodeOtlpConfig`, `removeCopilotChatOtlpConfig`, `removeCopilotCliOtlpConfig`) describe unlinking/disable without executing.

### Task 6: install/uninstall + docs install planners

**Files:**
- Modify: `src/cli/commands/install.ts` (add planner; convert `process.exit` → `process.exitCode`); `src/cli/commands/uninstall.ts:168,173`; `src/cli/commands/docs.ts:42-58`.

**Interfaces:**
- Consumes: `describeInstall()/describeUninstall()/describeAdditionalInstallation()` (Task 3), `plannedAction[]` + footers (Task 1).
- Produces: command-level `buildPreviewPlan()` hook used when tier-1 short-circuit fires.

- **Test-first: no** (concatenation of Task 3 seams + command effects).

- [ ] **Step 1:** In `install.ts`, when `--dry-run`, build `PlannedAction[]` = adapter `describeInstall()` + `describeAdditionalInstallation()` + `restoreCliBinLink()` (global symlink rewrite, install.ts:194) + the `statusline` path (install.ts:294-318) described as a statusline-script write; print, then `printEndCap()`, and exit 0. Mirror in `uninstall.ts` with `describeUninstall()`.
- [ ] **Step 2:** In `docs.ts:42-58`, thread `--dry-run`: build the plan from the framework adapter's `describeInstall()` and print with the end-cap.
- [ ] **Step 3:** Convert `process.exit(1)` to `process.exitCode = 1` in install.ts and uninstall.ts:168,173 so the footer prints before failure exit.

### Task 7: setup wizard planner (ask, never apply)

**Files:**
- Modify: `src/cli/commands/setup.ts:52,229-397` (add a dry-run branch around `handlePluginSetup`/`runSetupWizard`).

**Interfaces:**
- Consumes: `describeCredentialSideEffects()` (Task 4), `PlannedAction` (Task 1).
- Produces: setup's dry-run path — asks, describes, exits 0.

- **Test-first: no** (interactive wizard; core sign-in suppression already pinned by Task 4's describe contract).

- [ ] **Step 1:** `codemie setup --dry-run` keeps the wizard questions (`getCredentials` asked), but instead of applying, concatenate `describeCredentialSideEffects()` into the plan and append described-only steps for every suppressed mutation: `fetchModels`/`installModel`, `saveUserEmail`, `saveProfile`/`initProjectConfig`/`switchProfile`, and `checkAndInstallClaude` (setup.ts:229-397).
- [ ] **Step 2:** Model-list step: name models from a non-authenticated catalog where the provider offers one; otherwise `label: "would configure <provider>"` with the targets listing "model list requires sign-in" — never claim an unresolved model.
- [ ] **Step 3:** Print the plan + `printEndCap()`; exit 0. Convert `setup.ts:45` `process.exit(1)` → `process.exitCode = 1`.

### Task 8: profile planner

**Files:**
- Modify: `src/cli/commands/profile/index.ts:37-43,105-151` and `src/cli/commands/profile/auth.ts:14,125-148`.

**Interfaces:**
- Consumes: `PlannedAction` + footers (Task 1).

- **Test-first: no** (described-only wrappers over existing profile/session operations).

- [ ] **Step 1:** Under `--dry-run`, the mutating subcommands (login/logout/refresh/switch/delete/rename) print a `PlannedAction[]` (e.g. switch → `write-file` onto the ConfigLoader target; login → `store-credential` "would start sign-in") + end-cap, instead of calling `ConfigLoader`/auth writers.
- [ ] **Step 2:** `profile refresh` and `profile login` describe-and-never-start sign-in; never store a credential.
- [ ] **Step 3:** `profile status` (invalid-auth branch, profile/index.ts:105-151) reads `validateAuth` but suppresses `promptForReauth`/`authenticate`, describing "would re-authenticate"; bare `profile`/list prints the tier-2 footer and runs normally.

### Task 9: proxy connect/disconnect planner

**Files:**
- Modify: `src/cli/commands/proxy/connect-orchestrator.ts` (add `describeConnect()`; convert `verifySsoCredentials` :288 `process.exit` and `printProxyError` :315 `process.exit(1)` → `process.exitCode = 1`); `src/cli/commands/proxy/index.ts:286-372`.

**Interfaces:**
- Consumes: connector `describe()/describeRemove()` (Task 5), `PlannedAction` + end-cap (Task 1).

- **Test-first: no** (orchestrator routing over Task 5 seams).

- [ ] **Step 1:** `describeConnect()` enumerates, without executing, the sequence as planned actions: read-only SSO-credential pre-flight via `getStoredPlatformCredentials` (missing cred → `would fail: no SSO credentials` + failure status + footer), skill sync (list target files), Claude bundle writes, daemon ensure (`start-process`/`stop-process` pair for `--force`/mismatch/unhealthy), gateway-key `store-credential`, and all seven connector `describe()` writers.
- [ ] **Step 2:** `describeDisconnect()` (disconnect-orchestrator.ts:153-175) concatenates the four `describeRemove()` removers and states the daemon is never touched.
- [ ] **Step 3:** `--codex-desktop`: name explicit `--model` slug else "would select the best available model". A dry run never enters `connectTargets`/`ensureDaemon`/`verifySsoCredentials`.

### Task 10: Analytics gate + legacy footer unification

**Files:**
- Modify: `src/cli/commands/skill.ts:210-226`, `src/cli/commands/log/index.ts:143`, `src/cli/commands/workflow.ts:156`, `src/cli/commands/test-metrics.ts:32` (footer only).

**Interfaces:**
- Consumes: `printEndCap()` (Task 1).

- **Test-first: no** (copy-level footer addition + gate verification).

- [ ] **Step 1:** Confirm whether install/setup/docs emit analytics or session metrics on the real path (trace a real call into `metrics-api-client.ts:311-607`). If they do, thread the CLI dry-run gate to the existing `dryRun` switch in `metrics-api-client.ts`; if not, add a per-command negative statement in the plan ("no analytics are sent"). Record which.
- [ ] **Step 2:** Append `printEndCap()` (the "Nothing was changed." footer) after each of the four legacy previews' output — do not otherwise refactor their workers.
