/**
 * Check if a process group is still alive.
 * Uses signal 0 to test existence without actually sending a signal.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
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
  if (!Number.isInteger(pgid) || pgid <= 0) {
    throw new RangeError("Process group ID must be a positive integer");
  }
  process.kill(-pgid, signal);
}
