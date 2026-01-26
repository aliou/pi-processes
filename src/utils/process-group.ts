/**
 * Check if a process group is still alive.
 * Uses signal 0 to test existence without actually sending a signal.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // EPERM: exists, but we can't signal it
    return err.code === "EPERM";
  }
}

/**
 * Send a signal to an entire process group.
 * Negative PID targets the process group.
 */
export function killProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  process.kill(-pgid, signal);
}
