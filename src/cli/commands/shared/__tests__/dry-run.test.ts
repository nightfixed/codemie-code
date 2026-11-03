import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDryRunInvocation, printDryRunFooter } from '../dry-run.js';

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.restoreAllMocks();
});

describe('isDryRunInvocation', () => {
  it('is true for a bare --dry-run token', () => {
    expect(isDryRunInvocation(['--dry-run'])).toBe(true);
  });

  it('is true when --dry-run follows command arguments', () => {
    expect(isDryRunInvocation(['install', 'x', '--dry-run'])).toBe(true);
  });

  it('is false for an explicit --dry-run=false', () => {
    expect(isDryRunInvocation(['--dry-run=false'])).toBe(false);
  });

  it('is false for a --task invocation', () => {
    expect(isDryRunInvocation(['--task', 'x'])).toBe(false);
  });

  it('is false for a plain command without the flag', () => {
    expect(isDryRunInvocation(['list'])).toBe(false);
  });

  it('is false when --dry-run appears after the -- delimiter', () => {
    expect(isDryRunInvocation(['install', 'x', '--', '--dry-run'])).toBe(false);
  });
});

describe('printDryRunFooter', () => {
  it('prints the tier 1 footer verbatim', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printDryRunFooter(1);

    expect(writeSpy).toHaveBeenCalledWith('Nothing was changed.\n');
  });

  it('prints the tier 2 footer verbatim', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printDryRunFooter(2);

    expect(writeSpy).toHaveBeenCalledWith(
      'Nothing to preview — this command does not modify anything.\n',
    );
  });

  it('prints the tier 3 footer verbatim', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printDryRunFooter(3);

    expect(writeSpy).toHaveBeenCalledWith(
      'Dry run is not available for this command yet; nothing was changed.\n',
    );
  });
});

describe('printEndCap', () => {
  /**
   * printEndCap keeps printed-once state at module scope, so every case loads a
   * fresh copy of the module after resetting the registry.
   */
  async function loadPrintEndCap(): Promise<() => void> {
    vi.resetModules();
    const { printEndCap } = await import('../dry-run.js');
    return printEndCap;
  }

  function invokeExitListeners(exitSpy: ReturnType<typeof vi.spyOn>): void {
    for (const [event, listener] of exitSpy.mock.calls) {
      if (event === 'exit') {
        (listener as () => void)();
      }
    }
  }

  it('prints the end-cap once and does not reprint from the exit fallback', async () => {
    process.argv = ['node', 'codemie', 'install', 'claude', '--dry-run'];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'on');
    const printEndCap = await loadPrintEndCap();

    printEndCap();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith('Nothing was changed.\n');

    printEndCap();
    invokeExitListeners(exitSpy);

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not print from the exit fallback for a non-dry-run process', async () => {
    process.argv = ['node', 'codemie', 'install', 'claude'];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'on');
    const printEndCap = await loadPrintEndCap();

    printEndCap();
    invokeExitListeners(exitSpy);

    expect(writeSpy).not.toHaveBeenCalled();
  });
});
