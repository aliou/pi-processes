/**
 * codex-unified-exec config shape.
 *
 * The only codex setting is the host-repo `enabled` gate (not a codex semantic).
 * It lives as a `codexExec` sub-section of the pi-processes config so it is
 * edited through the single /ps:settings command rather than a separate
 * settings command. Codex's runtime caps are constants, not settings (see
 * ../constants).
 */

export interface CodexExecConfig {
  /**
   * When true, the extension creates its own ProcessManager instance and
   * registers the unified_exec tools. Defaults to false.
   */
  enabled?: boolean;
}
