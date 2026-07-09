/**
 * Platform gate for the processes extensions.
 *
 * The manager spawns detached process groups and kills them by negative pid
 * (`src/utils/process-group.ts`), which is a POSIX-only operation. On Windows
 * there is no process-group kill and detached spawn semantics differ, so the
 * extensions intentionally no-op there rather than silently misbehaving.
 *
 * Main (0.9.4) shipped the same guard. The rewrite had dropped it.
 */
export function isWindowsPlatform(): boolean {
  return process.platform === "win32";
}
