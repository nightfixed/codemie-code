# Technical Research

**Task**: cli commander dry-run preview
**Generated**: 2026-11-03
**Research path**: codegraph

---

## 1. Original Context

EPMCDME-16643 — Add dry-run previews to user-facing CodeMie CLI commands.

Introduce a consistent `--dry-run` option for user-facing CodeMie CLI commands, beginning with previews for install/uninstall, setup, profile, config, and docs install.

Acceptance criteria:
1. Every user-facing CLI command accepts --dry-run without an unknown-option error. Tool-invoked commands — hook, opencode-metrics, mcp-proxy, and the proxy daemon — do not offer the flag and retain existing behavior.
2. In the first delivery, install/uninstall, setup, profile, config, and docs install each provide an accurate, plain-language list of planned actions and where they would apply, ending with a clear statement that nothing was changed.
3. A dry run makes no file or configuration writes, installs or removes nothing, starts or stops no background process, and stores no credentials.
4. Commands that normally prompt the user still ask their questions, then preview the result of the answers without applying it.
5. Read-only commands, such as list, version, doctor, and models, run normally with a short note that there is nothing to preview.
6. Network lookups needed for an accurate preview are permitted; analytics and other outbound data submissions, credential storage, and server-side changes are not.
7. A command that would start sign-in describes that action without starting it.
8. A dry run that would succeed returns the successful command's exit status. Invalid or unsupported input produces the applicable error and failure status, with a statement that nothing was changed.
9. Out of scope: full previews for mutating commands outside the first delivery, machine-readable preview output, and agent-chat dry runs.

Constraints: This concerns commands typed at the command line (CLI), NOT dry-run behavior inside agent chat sessions. Use CodeGraph first. Follow the repository's guide-first rule (load relevant .ai-run/guides/ before searching). Write a complete technical-analysis.md containing at minimum "Codebase Findings", "Risk Indicators", and the facts-layer sections "Decisions Already in the Code" and "Task Statements Checked Against the Code", plus a section 7 "Summary for Complexity Assessment". Return a ≤400-word digest.

---

## 2. Codebase Findings

### Existing Implementations

The "dry-run" concept already exists in the codebase in four independent, ad-hoc places — the task is to make it *consistent*, not to invent it.

**Purpose A — a `--dry-run` flag that previews a mutation without applying it.** Served today by four per-command flags:
- `src/cli/commands/skill.ts:210` — `codemie skill sync --dry-run`: `.option('--dry-run', 'Preview what would be synced without writing')`; line 223 passes `dryRun: options.dryRun`; line 226 prefixes output with `[dry-run]`.
- `src/cli/commands/log/index.ts:143` — `codemie log clean --dry-run`: `.option('--dry-run', 'Preview what would be deleted without actually deleting')`; line 326 prints "Run with --dry-run to preview what would be deleted."
- `src/cli/commands/workflow.ts:156` — `.option('--dry-run', 'Preview installation without writing files')`.
- `src/cli/commands/test-metrics.ts:32` — `.option('--dry-run', 'Show payload and curl command without sending')`.

**Purpose B — thread a `dryRun` boolean into a mutable operation that branches to skip writes.** Served today by:
- `src/skills/sync/SkillSync.ts:17,73,96,128,159,180` — `syncToClaude({ dryRun })` reports the skill but writes nothing (`if (!dryRun)` guards). Consumer: `src/cli/commands/skill.ts:223`. Tested: `src/skills/sync/__tests__/SkillSync.test.ts:123`.
- `src/workflows/installer.ts:20,45` — `dryRun` skip of writes (`if (dryRun)`); type at `src/workflows/types.ts:75`.
- `src/migrations/runner.ts:17,21,61,71,107` — `runPending({ dryRun })` applies logic but records nothing, so migrations stay pending. Consumer: `bin/codemie.js:38` (calls without `dryRun`). Tested: `src/migrations/__tests__/migration-runner-ordering.test.ts:211`.

**Purpose C — dry-run that logs/emits data but sends nothing over the network.** Served by:
- `src/providers/plugins/sso/session/processors/metrics/metrics-api-client.ts:311,334,460,561,607` — `dryRun` mode makes no HTTP request. Tested: `src/providers/plugins/sso/session/processors/metrics/__tests__/metrics-upload-contract.test.ts:301`.
- `src/env/types.ts:141` — `dryRun?: boolean` on metrics config ("log metrics without sending").
- `src/providers/plugins/sso/proxy/plugins/sso.session-sync.plugin.ts:120` — `isDryRunEnabled` (env `CODEMIE_SESSION_DRY_RUN`, or `session.sync.dryRun` profile config).
- `src/agents/core/types.ts:753` — `AgentAdapter.run(args, env, options?: { dryRun?: boolean })`: agent-*chat* run dry-run (out of scope per constraint).

No "nothing was changed" end-cap statement exists anywhere today — the closest is the SkillSync test asserting "writes nothing to disk" and `log/index.ts:326` advertising the preview flag.

### Decisions Already in the Code

- **CLI framework is Commander** (`src/cli/index.ts:6,48`; `import { Command } from 'commander'`). Unknown options are rejected by Commander by default (`.option()` and per-command options define the accepted surface). No `.allowUnknownOption()` is set anywhere. `src/agents/core/AgentCLI.ts` comment references "Commander.js v11 behavior".
- **Dry-run convention is per-command, not global**: each of the four existing flags is declared via `.option('--dry-run', …)` on its own subcommand; there is no shared helper, no program-level `--dry-run`, and no option applied across all commands. The boolean is then passed into the mutating function as an argument.
- **Exit / error handling is inconsistent**: most commands use `process.exit(1)` on failure (`src/cli/commands/uninstall.ts:168,173`, `install.ts`, `setup.ts:45`, `profile/index.ts`), while `src/cli/commands/docs.ts:48,56,66,74,85` uses `process.exitCode = 1`. Success returns normally (exit 0). This matters for AC8 exit-status parity.
- **Progress/UX conventions**: `ora` spinners around agent/framework install-uninstall (`uninstall.ts:94,117`); `chalk` for color; `logger.*` vs `console.*` mixed; yellow `[dry-run]` prefix precedent in `skill.ts:226`.
- **Data direction note**: dry-run state is currently read from a config/env flag (`CODEMIE_SESSION_DRY_RUN` / `session.sync.dryRun` / `metrics.dryRun`), i.e. **configured**, not from a `--dry-run` argv flag at the CLI layer. The four CLI `--dry-run` flags are argv-only and do not consult this config.

### Task Statements Checked Against the Code

- **"Every user-facing CLI command accepts --dry-run"** — today only 4 commands (`skill sync`, `log clean`, `workflow`, `test-metrics`) accept it; the other ~26 top-level commands (`src/cli/index.ts:84-112`) do not, and Commander rejects unknown options. The statement is a design target, not current state (contradicted as a current-behavior claim).
- **"Tool-invoked commands hook, opencode-metrics, mcp-proxy, and the proxy daemon do not offer the flag"** — holds: none has a `--dry-run` flag. `opencode-metrics.ts:216` hardcodes `dryRun: false`. `hook`, `mcp-proxy` are subcommands of the main program (`src/cli/index.ts:97,107`); the proxy daemon is a **separate binary** with its own Commander parser (`src/bin/proxy-daemon.ts:64-95`), not a `codemie` subcommand.
- **"…previews for install/uninstall, setup, profile, config, and docs install"** — `config` has **no matching command**: `command('config')` / `Command('config')` / `createConfigCommand` return no matches; there is no `src/cli/commands/config.ts`. `install`, `uninstall`, `setup`, `profile`, `docs` all exist (`src/cli/commands/{install,uninstall,setup,docs}.ts`, `profile/index.ts`).
- **"Commands that normally prompt still ask their questions"** — holds: `profile` (login/logout/switch/delete → `promptProfileSelection`, `profile/index.ts:308`) and `setup` wizard (`setup.ts:52 runSetupWizard`) are interactive. `docs install` and `install <name>` do not prompt.
- **"Read-only commands list/version/doctor/models run normally"** — holds: `list.ts`, `version.ts`, `doctor/`, `models.ts` are read-only (query registries/version, no writes).
- **"Sign-in command describes without starting"** — `profile login` exists (`profile/auth.ts:14 createLoginCommand` / `handleLogin:65`); it is the sign-in path.
- **"Exit-status parity"** — mixed today (`process.exit(1)` vs `process.exitCode = 1`), see Decisions Already in the Code.

### Consumers of Changed Contracts

The `--dry-run` flag is currently **not** a shared contract — each flag is local to its command factory. Introducing a shared option/helper would touch:
- the four existing `--dry-run` flags (`skill.ts`, `log/index.ts`, `workflow.ts`, `test-metrics.ts`) if unified (spec choice — not weighed here).
- the mutation entry points that must branch on the new flag: `AgentRegistry`/`FrameworkRegistry` install-uninstall implementations reached from `install.ts`/`uninstall.ts`/`docs.ts` (e.g. `ClaudePlugin.install`, `CodegraphPlugin.install`, `CodebaseMemoryPlugin.install` — runtime-dispatched to `BaseAgentAdapter`/`BaseFrameworkAdapter` subclasses, 19 `install` implementations + framework adapters); `ConfigLoader` writes for `profile`/`setup`; `runSetupWizard`.
- `bin/codemie.js:38` calls `MigrationRunner.runPending` without `dryRun` today (a dry-run-capable consumer not using the flag).

### Architecture and Layers Affected

- **CLI layer** (`src/cli/index.ts`, `src/cli/commands/*`) — Commander program and command factories; the primary change surface.
- **Registry/Plugin layer** — install/uninstall route to `AgentRegistry` (`src/agents/registry.ts`) and `FrameworkRegistry` (`src/frameworks/`); `docs install` → framework adapters (`codegraph`, `codebase-memory`, `graphify`, …).
- **Core layer** — `src/agents/core/types.ts` (`AgentAdapter`), `src/frameworks/core/BaseFrameworkAdapter.ts` already separate `install`/`uninstall` from other behavior.
- **Utils layer** — `ConfigLoader` (`src/utils/config.ts`), `logger`, `ora`, `chalk`.
- **Separate binaries** — `bin/codemie.js` (startup migrations/update/what's-new), `src/bin/proxy-daemon.ts` (out of scope, separate parser).

### Integration Points

- `ConfigLoader` (profile creation/switch/delete; setup wizard writes `.codemie/` config) — `src/utils/config.ts`, referenced widely.
- `AgentRegistry.getAgent` / `FrameworkRegistry.getFrameworksByGroup` / `getFramework` — install/uninstall/docs routing.
- Outbound network: `ConfigLoader.load` can contact `codeMieUrl`; SSO sign-in (`profile login`); analytics/metrics via `metrics-api-client.ts` (has internal `dryRun`).
- `MigrationRunner` + upgrade notice run at startup (`bin/codemie.js`) before command parsing.

### Patterns and Conventions

- Command factories `createXxxCommand(): Command` returning `new Command('name')` (`src/cli/index.ts:84-112`).
- Per-command options via `.option()`; positional args via `.argument()`.
- Mutation functions accept an options object carrying a boolean `dryRun` and branch before writes.
- `async`/`await` throughout; ES modules with `.js` import suffixes; `@/` alias; `process.exit(1)` for failure; `ora` spinners; `chalk` colors; `logger` for debug-level output.

---

## 3. Documentation Findings

### Guides and Architecture Docs

Relevant guides found under `.ai-run/guides/`:
- `architecture/architecture.md` — 5-layer plugin architecture; "CLI → Registry → Plugin → Core → Utils" flow; "CLI layer does not contain business logic"; error-flow section.
- `development/development-practices.md` — error handling, logging, async patterns (not read in full; conventions from code above).
- `usage/project-config.md` — ConfigLoader, profiles, env vars, paths (referenced for profile/config).
- `integration/exposed-api.md` — CLI surface, plugin contracts.

No guide documents dry-run behavior. The only dry-run mention in user-facing text is `src/utils/tips.json:360,569,784` ("`codemie skill sync … --dry-run`", "`codemie log clean … --dry-run`", "`codemie test-metrics --dry-run`").

### Architectural Decisions

No ADR or recorded decision covers dry-run. The "CLI must not contain business logic" rule (`architecture.md:96`) constrains where preview *planning* lives vs. where printing lives.

### Derived Conventions

Dry-run preview convention, inferred from the four existing flags: flag on the command → thread a boolean into the worker → worker branches to report rather than write → CLI prints a plain-language result. No shared abstraction yet.

---

## 4. Testing Landscape

### Existing Coverage

Vitest, co-located `__tests__/` (per `AGENTS.md` and `testing-patterns.md`).
- `src/skills/sync/__tests__/SkillSync.test.ts:123` — dry-run reports but writes nothing to disk.
- `src/migrations/__tests__/migration-runner-ordering.test.ts:211` — dry-run leaves migrations pending.
- `src/providers/plugins/sso/session/processors/metrics/__tests__/metrics-upload-contract.test.ts:301` — dry-run makes no HTTP request.
- CLI command tests: `src/cli/commands/__tests__/install.version-selection.test.ts`, `src/cli/commands/__tests__/cli-misc-coverage.test.ts` (list), `src/cli/commands/profile/__tests__/{index,auth}.test.ts`.
- `workspace`-adjacent: `src/cli/commands/shared/__tests__/registration-writes.test.ts:140` — "does not save at all when nothing was written".

### Testing Framework and Patterns

Vitest; dynamic-import mocking (per `testing-patterns.md`); registry mocking at CLI layer; mock external tools/fs/network at plugin layer.

### Coverage Gaps

No tests for `uninstall` (`createUninstallCommand` — "no tests found within 3 caller hops"), the `setup` wizard, `docs` commands, or the new `--dry-run` end-to-end path on any of install/uninstall/setup/profile/docs. No test asserts an end-cap "nothing was changed" message (that text does not exist yet).

---

## 5. Configuration and Environment

### Environment Variables

- `CODEMIE_SESSION_DRY_RUN` — session-sync dry-run (`sso.session-sync.plugin.ts:122`).
- `CODEMIE_SESSION_SYNC_ENABLED`, `CODEMIE_DEBUG`, `CODEMIE_AUTO_UPDATE`, `NODE_ENV`/`VITEST` (startup gating in `bin/codemie.js:54`).
- No general `--dry-run`-leveraging env var exists.

### Configuration Files

- Profile config via `ConfigLoader` (`~/.codemie/`, `.codemie/`) — `src/utils/config.ts`, `src/env/types.ts` (`metrics.dryRun`, `session.sync.dryRun`).
- Migrations metadata `~/.codemie/migrations.json` (referenced in `bin/codemie.js:35`).

### Feature Flags and Deployment Concerns

No feature flags for dry-run. `--dry-run` is argv-only today. The `metrics.dryRun` / `session.sync.dryRun` config fields exist but are unrelated to argv previews.

---

## 6. Risk Indicators

- **`config` command does not exist** — AC2 names it as a first-delivery command, but no `command('config')`/`createConfigCommand` exists. Spec must resolve the name mapping (or it is an unstated new command); an unmarked assumption here will break acceptance review. See "Task Statements Checked Against the Code".
- **Broad, under-specified surface** — ~26 top-level commands; AC1 says *every* user-facing command accepts `--dry-run` while only 4 are named as tool-invoked. The user-facing/tool-invoked boundary for the other ~22 commands (e.g. `test-metrics`, which already *has* `--dry-run`, vs `opencode-metrics`, which must not) is implicit and needs definition.
- **Four ad-hoc dry-run implementations, no shared helper** — consistency (AC1) will require either unifying them or adding a 5th pattern; the existing three "preview" flags have divergent wording and no shared "nothing was changed" footer exists anywhere (AC2 requirement is net-new text).
- **Mixed exit-code handling** — `process.exit(1)` vs `process.exitCode = 1` across commands complicates AC8 ("successful exit status" + "failure status with a nothing-changed statement").
- **Out-of-scope agent-chat dry-run collision** — `AgentAdapter.run(…, { dryRun })` (`types.ts:753`) and `opencode-metrics.ts:216 dryRun:false` already use the name for non-CLI purposes; a CLI `--dry-run` must not bleed into these.
- **AC6 routing** — analytics outbound must be suppressed during dry-run, but the existing dry-run gate lives deep in the SSO metrics/session pipeline (`metrics-api-client.ts`), not at the CLI layer; install/setup paths do not currently thread a `dryRun` to it.
- **No test coverage** for uninstall/setup/docs and no end-to-end dry-run tests on any first-delivery command.

---

## 7. Summary for Complexity Assessment

The change is concentrated in the CLI layer: a `--dry-run` option threaded through the Commander command factories in `src/cli/index.ts` and the six first-delivery command modules (`install`, `uninstall`, `setup`, `profile`, `docs`, plus an undefined `config`), with each routing to existing install/uninstall/config call sites in the Registry/Plugin layer. Because install/uninstall dispatch at runtime to ~19 agent `install` implementations plus framework adapters, the *preview* lives above those calls (in the CLI layer, per the "no business logic in CLI" rule the *planning* must call read-only surfaces like `isInstalled`/`getVersion`/`ConfigLoader.listProfiles`), so the mutation plumbing itself needs little change.

Technical novelty is low — the codebase already establishes the exact pattern (per-command `.option('--dry-run', …)` + a boolean `dryRun` branched in the worker) in four places (`skill sync`, `log clean`, `workflow`, `test-metrics`) and even an env/config-gated dry-run in the session-sync pipeline. The novel parts are breadth (consistency across ~26 commands), the "nothing was changed" end-cap (net-new text everywhere), and suppressing outbound analytics during a dry run.

Coverage posture is mixed: dry-run *behavior* is unit-tested in three subsystems (SkillSync, migrations, metrics-sender), but the target CLI commands are under-tested (`uninstall`, `setup`, `docs` have none) and there is no end-to-end `--dry-run` test on any first-delivery command. Key risks are the nonexistent `config` command, the ambiguity of the user-facing/tool-invoked boundary, the four divergent existing implementations, and inconsistent exit-code handling.

---

## 8. External References

None named by the task.

## Facts Added by Review

Researched for the names the spec relies on, after the analysis above was written. Read like the facts layer; where a line here contradicts one above, this one was read later.

- `writeVsCodeLanguageModelsConfig()` (`:269`) → `writeVsCodeLanguageModelsConfigAtPath()` (`:281`). Pipeline: `readProviders()` (`:216`, strict `JSON.parse`, must be a JSON array, throws `ConfigurationError` on invalid and leaves the file unchanged) → `resolveManagedModels()` (`:161`) → `fetchTenantModelDescriptors()` (`tenant-catalog.ts:154`, GET `/v1/llm_models?include_all=true` with 10s timeout against the running proxy `state.url`) → `mergeManagedProviders()` (`:182`, single `CodeMie`/`customendpoint` provider, preserves an existing `${input:chat.lm.secret.*}` `apiKey` or omits it) → `writeAtomically()` (`:247`, temp file + `rename`, preserves file mode). Returns `{ configPath, requiresSecretConfiguration, modelCount }`.
- **In-repo read:** only `readProviders()` (`vscode.ts:216`) reads the file back — solely to merge on a subsequent write. `getVsCodeLanguageModelsPath` has 1 caller (in `vscode.ts`). No other repo code reads it.
- **Tests reading/pinning the path:** `src/cli/commands/proxy/connectors/__tests__/vscode.test.ts:88`, `tests/integration/vscode-byok.test.ts:240`, `src/cli/commands/proxy/__tests__/index.test.ts:521`.
- **getCredentials** — interface member `ProviderSetupSteps.getCredentials(isUpdate?)` at `src/providers/core/types.ts:300`, consumed at `setup.ts:240`. Implementations: `sso.setup-steps.ts:47` (prompts CodeMie URL → browser auth → project selection → integration resolve; returns `ProviderCredentials` whose `additionalConfig` carries `userEmail` and `cookies`); `litellm.setup-steps.ts:14` (inquirer baseUrl + apiKey); `bedrock.setup-steps.ts:104` (auth-method prompt, lists AWS profiles, **writes a real AWS CLI profile via `createAwsProfile`**); `ollama.setup-steps.ts:60` (baseUrl + health check + optional cloud key); also `jwt.setup-steps.ts:23`, `moonshot-subscription.setup-steps.ts:25`, `anthropic-subscription.setup-steps.ts:29`.
- **fetchModels** — two contracts: model-proxy `fetchModels(config: CodeMieConfigOptions)` (`ProviderModelFetcher`, `types.ts:263`) — `sso.models.ts:84`, `bedrock.models.ts:39`, `litellm.models.ts:60`, `ollama.models.ts:188`; and setup-step `fetchModels(credentials): Promise<string[]>` (`types.ts:307`) — `litellm.setup-steps.ts:37` and the sso/anthropic/moonshot setup-step bodies. Consumed at `setup.ts:247`.
- **installModel** — two contracts: model-level `ModelInstallerProxy.installModel(modelName, onProgress?)` (`types.ts:234`), default throws at `BaseModelProxy.ts:53`, real impl `OllamaModelProxy.installModel` at `ollama.models.ts:237` (`POST /api/pull`, streams progress); and setup-step `installModel?(credentials, selectedModel, availableModels)` (`types.ts:350`), Ollama impl at `ollama.setup-steps.ts:413` (checks installed then pulls). Consumed at `setup.ts:270`.
- **saveUserEmail** — `src/utils/config.ts:594`; loads multi-provider config, sets `config.userEmail`, saves via `saveMultiProviderConfig` (global file). Consumed at `setup.ts:289`.
- **saveProfile** — `src/utils/config.ts:651`; loads config, strips top-level-only fields, splits profile/workspace via `splitProfileAndWorkspace`, sets `profiles[name]`, activates when first profile, saves global. 2 callers in `setup.ts` (`:345`); test `config-project-override.test.ts`.
- **initProjectConfig** — `src/utils/config.ts:930`; `mkdir .codemie/` then writes `codemie-cli.config.json`. Consumed at `setup.ts:312` (local-storage branch).
- **switchProfile** — `src/utils/config.ts:729`; verifies profile exists (`listProfiles`), then rewrites `activeProfile` into local or global config file. Consumed at `setup.ts:338` (local) and `setup.ts:362` (global).
- **checkAndInstallClaude** — `src/cli/commands/setup.ts:707`; checks `claude.isInstalled()`, prompts confirm, then `claude.installVersion('supported')` (or `claude.install()`). Called during `runSetupWizard`.
- Profile persistence is split: `splitProfileAndWorkspace` (`config.ts:632`) routes workspace-scoped keys into `config.workspace` and the rest into `profiles[name]`; `saveProfile`/`initProjectConfig` both honor it. This bounds "where the preview would apply" (profile vs workspace vs top-level `userEmail`).
- SSO setup returns in-memory `cookies` in `additionalConfig` so `fetchModels` reuses the authenticated session without re-reading the credential store (`sso.setup-steps.ts:152`), not persisted in profile.
- "Commands that normally prompt still ask their questions" — holds: every `getCredentials` impl is inquirer-driven (`sso.setup-steps.ts:47`, `bedrock.setup-steps.ts:104`, `litellm.setup-steps.ts:14`); `checkAndInstallClaude` prompts (`setup.ts:723`).
- "No credential storage" on dry run — keeps `getCredentials` + `saveUserEmail`/`saveProfile`/`initProjectConfig` in place; `bedrock.getCredentials` already writes an AWS profile (`createAwsProfile`, `bedrock.setup-steps.ts:215`) and `sso.getCredentials` performs server-side browser auth and integration fetches (`sso.setup-steps.ts:52`, `:89`).
- "A command that would start sign-in describes it" — `sso.getCredentials` launches `authenticateWithCodeMie` (`sso.setup-steps.ts:52`) and `anthropic-subscription.getCredentials` runs `runClaudeBrowserLogin` (`anthropic-subscription.setup-steps.ts:40`).
- `fetchModels` (all four model proxies) — called by `handlePluginSetup` (`setup.ts:247`) and, for ollama, by `pi.models.ts`.
- `installModel` — `handlePluginSetup` (`setup.ts:270`); base-class tests `providers-core.test.ts`.
- `switchProfile` — `setup.ts:338`, `setup.ts:362`.
- `initProjectConfig` — `setup.ts:312`.
- `saveUserEmail` — `setup.ts:289`.
- `checkAndPromptForUpdate` — `src/utils/cli-updater.ts:345`. Non-blocking CLI-startup update check. Returns early for CodeMie Connect installs; rate-limits to once/24h via `LAST_CHECK_FILE`; calls `checkForCliUpdate()`, records the check timestamp, then either silent auto-update (`CODEMIE_AUTO_UPDATE`) or a prompt, both gated behind `acquireUpdateLock()/releaseUpdateLock()` (a `wx` lock file). On a verbose update it calls `process.exit(0)`. Writes: `LAST_CHECK_FILE`, `UPDATE_LOCK_FILE`, and the update itself. Consumers: `bin/codemie.js` (import at line 32, invoked at line 57).
- `showUpgradeNotice` — `src/utils/whatsnew.ts:313`. Prints the once-per-upgrade release notes (`✨ Updated to X`) then records the version as seen. Never throws; gated by `isWhatsNewEnabled()` → `isTipsEnabled()`, and by `shouldRunUpgradeNotice` (stdout/args contract). Consumers: `bin/codemie.js` (lines 72/78).
- `markVersionSeen` — `src/utils/whatsnew.ts:157`. Writes the version string to `getCodemiePath('.last-seen-version')` after `mkdirSync`. Best-effort — write failures are swallowed. Consumer: `showUpgradeNotice` (same file). This is a state write, so it is in scope for AC3 (a dry run must not write it).
- `connectTargets` — `src/cli/commands/proxy/connect-orchestrator.ts:766`. The unified `connect` orchestrator. Validates flag combos, resolves SSO proxy config, requires `baseUrl` (setup error otherwise) and `codeMieUrl` when `--claude-desktop`, verifies SSO credentials, runs the Claude Code OTLP confirmation prompt, syncs skills, derives daemon identity, calls `ensureDaemon`, then dispatches per-target writers and prints the summary; rolls back the daemon when all targets fail. Consumers: 5 call sites in `src/cli/commands/proxy/index.ts` (`codemie proxy connect` plus legacy `desktop`/`vscode` aliases).
- `ensureDaemon` — `src/cli/commands/proxy/connect-orchestrator.ts:393` (module-private). Ensures one daemon matching the requested config is running and healthy — health-checks, restarts on mismatch/unhealthy/`--force`, spawns via `spawnDaemon`; returns `{ state, startedInThisRun }`. Consumers: `connectTargets` only.
- `verifySsoCredentials` — `src/cli/commands/proxy/connect-orchestrator.ts:288`. Reads stored platform credentials (`getStoredPlatformCredentials`, provider `ai-run-sso`); if absent, prints `✗ No SSO credentials found…` and `process.exit(1)`. Consumers: `connectTargets` (line 851) and `prepareDaemonLaunch` (`src/cli/commands/proxy/launch-daemon.ts:23`). Hard `process.exit` — relevant to AC8 (dry run must return failure status, not exit).
- `printProxyError` — `src/cli/commands/proxy/connect-orchestrator.ts:315`. `never`-returning: `logger.error`, red `✗` line (`ConfigurationError.message` or `formatErrorForUser(... showSystem: false)`), then `process.exit(1)`. Consumers: `connectTargets` catch (line 896) and `proxy start` (`proxy/index.ts:159`).
- `fetchManagedMcpServers` — `src/cli/commands/proxy/connectors/managed-mcp-remote.ts:127`. Network GET `/v1/mcp/managed-servers?client=<client>` using stored SSO creds through `HTTPClient` (timeout 10000, maxRetries 3, TLS policy honored) + `buildAuthHeaders`. Returns `CanonicalMcpEntry[] | null` (`null` on any failure; `[]` only on an authoritative empty catalog); validates/picks each entry. Consumers: `runClaudeDesktop` (3 call sites in `connect-orchestrator.ts`). This is a permitted network lookup under AC6.
- `chatLanguageModels.json` — VS Code per-user language-models file. Path built by `getVsCodeLanguageModelsPath(insiders)` in `src/cli/commands/proxy/connectors/vscode.ts:103` → `join(productDir, 'User', 'chatLanguageModels.json')`. Written via `writeVsCodeLanguageModelsConfig`/`writeVsCodeLanguageModelsConfigAtPath` (uses `writeAtomically`) for VS Code BYOK/managed models. Consumers: `runVscodeByok`/managed-model writers. A concrete write target in the connect path (AC3).
- `AbortSignal.timeout` — not a project symbol; the standard Node API, used to bound individual network lookups: `src/cli/commands/proxy/connectors/codex-desktop.ts:178` (`MODEL_LIST_TIMEOUT_MS`, model-list fetch) and `src/agents/plugins/claude/plugin/statusline.ts:760` (`BUDGET_FETCH_TIMEOUT_MS`). Relevant as the existing pattern for bounding the network lookups a dry run is allowed to make.
- `validateAuth` is an optional method on `ProviderSetupSteps` (`src/providers/core/types.ts:371`).
- SSO impl `src/providers/plugins/sso/sso.setup-steps.ts:208` — resolves base URL, looks up stored SSO credentials, then performs a **live API access test** via `fetchCodeMieModels`; returns `{valid, error?, expiresAt?}`. No writes.
- JWT impl `src/providers/plugins/jwt/jwt.setup-steps.ts:144` — resolves token via `resolveJwtToken`, checks format + expiry; read-only.
- `promptForReauth` is an optional method on `ProviderSetupSteps` (`src/providers/core/types.ts:378`).
- SSO impl `src/providers/plugins/sso/sso.setup-steps.ts:255` — interactive `inquirer` confirm, then launches browser SSO (`new CodeMieSSO().authenticate({codeMieUrl, timeout:120000})`) which **stores credentials** (`storeSSOCredentials`) and clears analytics auth status; returns boolean.
- `restoreCliBinLink` (`src/utils/cli-bin.ts:27`) — checks the npm global `bin/codemie` symlink and, when it no longer points at `codemie.js`, **writes a corrected symlink** via atomic temp-symlink+rename. No-op on Windows and when already correct. Consumer: `src/cli/commands/install.ts` (post-update).
- `additionalInstallation` — optional on `AgentAdapter` (`src/agents/core/types.ts:788`), default no-op in `src/agents/core/BaseAgentAdapter.ts:265`.
- Claude override `src/agents/plugins/claude/claude.plugin.ts:892` — if `options.sounds`, **writes** the sounds dir (`installSounds`/`isSoundsInstalled`).
- Pi override `src/agents/plugins/pi/pi.plugin.ts:512` — `installRequiredPiPackages` (`src/agents/plugins/pi/pi.packages.ts:22`), which **runs `pi install <pkg>`** for 3 packages.
- `getUserFacingAgentName` (`src/agents/core/agent-aliases.ts:27`), `getAgentInstallCommand` (:40), `getAgentLauncherCommand` (:32), `getAgentUninstallCommand` (:45) — map canonical registry names to user-facing names (e.g. `copilot-cli` → `copilot`). `getAgentNames` (`src/agents/registry.ts:97`) returns adapter keys. Consumers: `src/cli/commands/install.ts`, `src/cli/commands/uninstall.ts`, `src/cli/commands/update.ts`, `src/cli/first-time.ts`, `src/agents/core/AgentCLI.ts`.
- `runVscodeClaudeCode` (`connect-orchestrator.ts:627`) — **writes** VS Code Claude Code config (`writeVsCodeClaudeCodeConfig`); 1 caller.
- `runCodexDesktop` (`connect-orchestrator.ts:657`) — discovers models via live network (`discoverCodexModels`), then `writeCodexDesktopConfig` (writes `config.toml` + state); 3 callers; test seam `runCodexDesktopForTest` (:707).
- `runClaudeCodeOtlp` (`claude-code-otlp-flow.ts:38`) — `writeClaudeCodeOtlpConfig` (writes Claude settings.json); 2 callers in connect-orchestrator.
- `runCopilotChatOtlp` (`connect-orchestrator.ts:713`) — `writeCopilotChatOtlpConfig` (writes hook file + VS Code settings); 1 caller.
- `runCopilotCliOtlp` (`connect-orchestrator.ts:740`) — `writeCopilotCliOtlpConfig` (writes hook file); 1 caller.
- `removeCodexDesktopConfig` (`connectors/codex-desktop.ts:388`) — surgical strip of managed block from `config.toml`, fallback to backup restore; **writes** config and clears state file; 4 callers. Tests: `codex-desktop-roundtrip.test.ts`, `codex-desktop.test.ts`.
- `removeClaudeCodeOtlpConfig` (`connectors/claude-code-otlp.ts:691`) — strips CodeMie-managed env/hooks from `settings.json`, restores `--force`-displaced values; **writes** settings; 3 callers. Tests: `claude-code-otlp.test.ts`.
- `removeCopilotChatOtlpConfig` (`connectors/copilot-chat-otlp.ts:226`) — removes hook-file location from VS Code settings, **unlinks** hook file, disables connector scope; 3 callers. Tests: `copilot-chat-otlp.test.ts`.
- `removeCopilotCliOtlpConfig` (`connectors/copilot-cli-otlp.ts:111`) — **unlinks** hook file, disables connector scope; 3 callers.
- The `AgentAdapter.run` signature already carries a dry-run seam: `run(args, env?, options?: { dryRun?: boolean })` (`src/agents/core/types.ts:753`) — this is for **agent-chat** dry runs, not the CLI `--dry-run` previews; the names collide but the semantics differ.
- `additionalInstallation`: `src/cli/commands/install.ts` (interface method declared on `AgentAdapter`, `types.ts:788`).
- Proxy connect runners + removers: `connectTargets` (`connect-orchestrator.ts:766`) and `disconnect-orchestrator.ts` respectively; all return a `TargetResult` / result shape consumed to build a per-target summary and set `process.exitCode = 1` on failure.
