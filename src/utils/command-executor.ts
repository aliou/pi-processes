// Uses node:child_process directly instead of pi.exec() because process
// management requires long-lived streaming processes with stdin/stdout piping
// and detached process groups, which pi.exec() does not support.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

interface ResolveShellExecutableOptions {
  configuredShell?: string;
  knownPaths: string[];
}

export function defaultKnownShellPaths(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    "/run/current-system/sw/bin/bash",
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
    ...(env.PREFIX ? [`${env.PREFIX}/bin/bash`] : []),
    ...(env.SHELL ? [env.SHELL] : []),
  ];
}

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
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  const shellExecutable = resolveShellExecutable({
    configuredShell,
    knownPaths: defaultKnownShellPaths(env),
  });

  return spawn(shellExecutable, ["-lc", command], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
}
