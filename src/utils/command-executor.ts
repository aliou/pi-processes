import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

interface ResolveShellExecutableOptions {
  configuredShell?: string;
  knownPaths: string[];
}

const DEFAULT_KNOWN_SHELL_PATHS = [
  "/run/current-system/sw/bin/bash",
  "/bin/bash",
  "/usr/bin/bash",
  "/usr/local/bin/bash",
];

function isExistingAbsolutePath(shell: string | undefined): shell is string {
  return typeof shell === "string" && isAbsolute(shell) && existsSync(shell);
}

export function resolveShellExecutable({
  configuredShell,
  knownPaths,
}: ResolveShellExecutableOptions): string {
  if (isExistingAbsolutePath(configuredShell)) {
    return configuredShell;
  }

  for (const path of knownPaths) {
    if (isExistingAbsolutePath(path)) {
      return path;
    }
  }

  throw new Error(
    "Unable to resolve shell executable. Checked configured shell and known shell paths.",
  );
}

export function spawnCommand(
  command: string,
  cwd: string,
  configuredShell?: string,
): ChildProcess {
  const shellExecutable = resolveShellExecutable({
    configuredShell,
    knownPaths: DEFAULT_KNOWN_SHELL_PATHS,
  });

  return spawn(shellExecutable, ["-lc", command], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
}
