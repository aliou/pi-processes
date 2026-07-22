/**
 * Extension config types for codex-unified-exec.
 *
 * User-facing schema is CodexExecConfig (all fields optional). Runtime config
 * uses the resolved protocol shape returned by ConfigLoader. Defaults live in
 * ./defaults and mirror codex's constants (see ../constants).
 */

export interface SessionsConfig {
  /** Maximum number of concurrently live sessions (codex: 64). */
  maxSessions?: number;
  /** Upper bound for an empty write_stdin poll (codex: 300000 ms / 30 min). */
  maxBackgroundPollMs?: number;
}

export interface OutputCapConfig {
  /** Per-session head+tail buffer cap in bytes (codex: 1 MiB). */
  maxBytes?: number;
  /** Default output token budget (codex: 10000). */
  defaultMaxOutputTokens?: number;
}

export interface CodexExecConfig {
  $schema?: string;
  /**
   * Host-repo gate (not a codex semantic). When true, the extension creates its
   * own ProcessManager instance and registers the unified_exec tools. Defaults
   * to false so the codex surface is opt-in.
   */
  enabled?: boolean;
  sessions?: SessionsConfig;
  output?: OutputCapConfig;
}

export interface CodexExecProtocolConfig {
  enabled: boolean;
  sessions: { maxSessions: number; maxBackgroundPollMs: number };
  output: { maxBytes: number; defaultMaxOutputTokens: number };
}
