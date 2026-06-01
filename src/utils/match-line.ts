/**
 * Shared line-matching logic used by both the notification log-matchers
 * and the output tool action. Pi-agnostic — no Pi imports.
 */

export type LineMatchMode = "literal" | "regex";

/**
 * Compile a pattern + mode into a line-matching predicate.
 *
 * - literal: substring match (case-sensitive).
 * - regex:   RegExp test (throws on invalid pattern).
 */
export function compileLineMatcher(
  pattern: string,
  mode: LineMatchMode,
): (line: string) => boolean {
  if (mode === "literal") {
    return (line) => line.includes(pattern);
  }

  const regex = new RegExp(pattern);
  return (line) => regex.test(line);
}
