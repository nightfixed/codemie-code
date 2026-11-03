/**
 * Layer-neutral dry-run plan model.
 *
 * `PlannedAction` and `PlanKind` are consumed by the CLI layer (rendering) and
 * by the `agents`/`providers`/`frameworks` core and plugin layers (the pure
 * `describeInstall`/`describeUninstall`/`describeCredentialSideEffects` seams).
 * Keeping the types here — outside `src/cli` — preserves the documented
 * CLI -> Registry -> Plugin dependency direction instead of letting every core
 * module import a CLI command module.
 */

/** Kinds of change a dry-run plan can name. */
export type PlanKind =
  | 'write-file'
  | 'remove'
  | 'install'
  | 'exec'
  | 'start-process'
  | 'stop-process'
  | 'store-credential'
  | 'network';

/** A single typed, command-level preview action. */
export interface PlannedAction {
  kind: PlanKind;
  /** Plain-language action sentence. */
  label: string;
  /** Files, bin links, config entries or commands the action would touch. */
  targets: string[];
}
