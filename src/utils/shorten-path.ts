import { homedir } from "node:os";
import { sep } from "node:path";

/** Replace a home-directory prefix with `~` for display. */
export function shortenPath(path: string, home = homedir()): string {
  if (path === home) return "~";
  if (path.startsWith(`${home}${sep}`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}
