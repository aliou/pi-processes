import { ProcessManager } from "./manager";

export interface ManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
}

/**
 * Create a ProcessManager for the current extension instance.
 * The extension owns shutdown and must call manager.killAll()/cleanup().
 */
export function getManager(opts?: ManagerOptions): ProcessManager {
  return new ProcessManager({
    getConfiguredShellPath: opts?.getConfiguredShellPath,
  });
}
