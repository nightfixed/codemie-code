/**
 * Shared dry-run core: the raw-argv predicate, the typed preview plan model, the
 * three footer strings, and the printed-once end-cap used by every `--dry-run`
 * command.
 */

export type PlanKind =
  | 'write-file'
  | 'remove'
  | 'install'
  | 'exec'
  | 'start-process'
  | 'stop-process'
  | 'store-credential'
  | 'network';

export interface PlannedAction {
  kind: PlanKind;
  /** Plain-language action sentence. */
  label: string;
  /** Files, bin links, config entries or commands the action would touch. */
  targets: string[];
}

const FOOTERS: Record<1 | 2 | 3, string> = {
  1: 'Nothing was changed.',
  2: 'Nothing to preview — this command does not modify anything.',
  3: 'Dry run is not available for this command yet; nothing was changed.',
};

const END_CAP = 'Nothing was changed.';

let endCapPrinted = false;
let exitFallbackRegistered = false;

/**
 * Detects a bare `--dry-run` token in raw CLI argv.
 *
 * The scan stops at the `--` delimiter and at `--task <value>` so that
 * pass-through arguments and task-flag values can never be mistaken for the
 * flag. `--dry-run=false` and `--no-dry-run` count as not-a-dry-run; a later
 * negation wins over an earlier bare flag.
 */
export function isDryRunInvocation(argv: string[]): boolean {
  let dryRun = false;

  for (const token of argv) {
    if (token === '--') {
      break;
    }
    if (token === '--task' || token.startsWith('--task=')) {
      break;
    }
    if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--dry-run=false' || token === '--no-dry-run') {
      dryRun = false;
    }
  }

  return dryRun;
}

/** Prints the footer that matches the command's dry-run tier. */
export function printDryRunFooter(tier: 1 | 2 | 3): void {
  process.stdout.write(`${FOOTERS[tier]}\n`);
}

/**
 * Renders a preview plan in plain text: each action's label, then each of its
 * targets on an indented bullet line. Prints nothing else — the end-cap is the
 * caller's job.
 */
export function printPlannedActions(actions: PlannedAction[]): void {
  for (const action of actions) {
    process.stdout.write(`${action.label}\n`);
    for (const target of action.targets) {
      process.stdout.write(`  - ${target}\n`);
    }
  }
}

function writeEndCap(): void {
  if (endCapPrinted) {
    return;
  }
  endCapPrinted = true;
  process.stdout.write(`${END_CAP}\n`);
}

/**
 * Prints "Nothing was changed." at most once, and registers a single `exit`
 * fallback that repeats it only for a dry-run invocation that has not printed
 * yet. The fallback covers failure paths that leave through `process.exit`
 * before the explicit call without ever printing for a normal run or twice.
 */
export function printEndCap(): void {
  if (!isDryRunInvocation(process.argv)) {
    return;
  }

  writeEndCap();

  if (exitFallbackRegistered) {
    return;
  }
  exitFallbackRegistered = true;

  process.on('exit', () => {
    if (!isDryRunInvocation(process.argv)) {
      return;
    }
    writeEndCap();
  });
}
