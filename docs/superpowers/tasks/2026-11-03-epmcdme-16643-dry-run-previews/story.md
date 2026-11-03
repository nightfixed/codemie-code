# Dry-run preview for CLI commands — Story

**Date**: 2026-10-30
**Status**: Draft
**Ticket**: —

---

## Context

- The CLI has about 29 top-level commands, many with subcommands. Each declares its own options, so there is no shared flag or common behaviour for previews today.
- Dry-run exists only in fragments: running an agent has an internal dry-run parameter, and session sync reads a dedicated environment setting. Neither is a user-facing convention across commands.
- Some commands already work out what they will change before applying it (skills and assistants setup), which gives a natural place to show a preview.
- Many commands change nothing (list, version, doctor, models, tips, whatsnew), so a preview means nothing for them.
- Some commands are run by tools rather than people (hook, opencode-metrics, mcp-proxy, the proxy daemon) and are poor candidates for a preview flag.
- Side effects vary widely: installing agents, writing configuration and credentials, starting and stopping background processes, uploading analytics, and signing in.

---

## Complexity

**Size**: L (21/36) · **Recommended flow**: sdlc-standard

The first delivery spans several command areas plus a new shared preview behaviour that does not exist today, and the meaning of a preview for read-only and tool-invoked commands needed to be decided (see Decisions).

---

## Story

**As a** CodeMie CLI user running commands from the command line (not in an agent chat), **I want** to add `--dry-run` to a command and see exactly what it would do without anything being changed, **so that** I can check the effect of a command before running it for real.

---

## Background

Several commands install software, write configuration and credentials, start background processes or remove things. Today the only way to learn what a command does is to run it. That is risky for commands that change the machine or the user's setup, and it makes the CLI hard to try safely, especially for new users and in scripts. A single, predictable `--dry-run` flag lets users preview any command before committing to it.

---

## Acceptance Criteria

- [ ] Given any user-facing command, when the user adds `--dry-run`, then the command is accepted without an "unknown option" error.
- [ ] Given a command that would change something (for example installing an agent, writing a profile, or changing configuration), when run with `--dry-run`, then it lists each planned action in plain language, states where it would apply, and ends with a clear message that nothing was changed.
- [ ] Given a command that would change something, when run with `--dry-run`, then no files are written, nothing is installed or removed, no background process is started or stopped, and no credentials are stored.
- [ ] Given a command run with `--dry-run` where the real run would succeed, when it finishes, then it exits with the same success status as a successful real run.
- [ ] Given a command that only reads information (for example list, version, doctor, models), when run with `--dry-run`, then it runs normally and shows a short note that there was nothing to preview.
- [ ] Given a command that normally asks the user questions, when run with `--dry-run`, then it asks the questions as usual and previews the result of the answers without applying anything.
- [ ] Given a command that needs information from the network to give an accurate preview (for example the latest version or a model list), when run with `--dry-run`, then it may fetch that information, but it does not send analytics or other data, does not store tokens or credentials, and does not change anything on the server.
- [ ] Given a command that starts a sign-in, when run with `--dry-run`, then it describes the sign-in it would start without starting one.
- [ ] Given a command that the real run would reject (for example missing required input or an unsupported value), when run with `--dry-run`, then it reports the same error and exits with the same failure status, with a message that nothing was changed.
- [ ] Given a command run by tools rather than people (hook, opencode-metrics, mcp-proxy and the proxy daemon), when it is run, then its behaviour is unchanged and it does not offer `--dry-run`.
- [ ] Given the first delivery, when the user runs `--dry-run` on install/uninstall, setup, profile, config, or docs install commands, then each shows an accurate preview as described above.

---

## Out of Scope

- Dry-run inside agent chat sessions; this story covers commands typed on the command line only.
- Machine-readable (JSON) output for previews.
- Commands run by tools rather than people (hook, opencode-metrics, mcp-proxy and the proxy daemon).
- Previews for the commands outside the first delivery (skills, assistants, proxy, analytics and the rest); they follow in later stories that reuse the same behaviour.
- A "preview only for a terminal, skip questions in scripts" mode.

---

## Decisions

- D1: Which commands accept `--dry-run`? → Every user-facing command accepts it; commands that change something preview, read-only commands run normally with a note, and tool-invoked commands are excluded — user
- D2: What does a preview show? → A readable list of planned actions ending with "nothing was changed", with the same exit status as the real run would have — user
- D3: How do commands that ask questions behave? → They ask as usual, then preview the result without applying — user
- D4: Can a dry run use the network? → Lookups are allowed; sending data, storing credentials and changing anything on the server are not — user
- D5: How is it delivered? → Phased: shared behaviour plus install/uninstall, setup, profile, config and docs install first; the remaining commands in later stories — user

---

## Open Questions

- None
