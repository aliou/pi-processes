---
"@aliou/pi-processes": minor
---

Add `codex-unified-exec` extension: an opt-in emulation of OpenAI Codex's
`unified_exec` session model (`exec_command` + `write_stdin` tools) layered over
the existing `ProcessManager`. Ports codex's `HeadTailBuffer`,
`collectOutputUntilDeadline`, `Notify`/`Gate`/`CancellationToken`, byte/token
truncation, `ExecCommandToolOutput` rendering, numeric session ids with LRU
eviction, and the `UNIFIED_EXEC_ENV` spawn env — directly from `codex-rs`, not
reinterpreted. Pipe-only (no PTY) initially. Disabled by default; toggle on via
the existing `/ps:settings` (the `codexExec.enabled` field, shared with the
processes config). POSIX-only, like the rest of pi-processes.
