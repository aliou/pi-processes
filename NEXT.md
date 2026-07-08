# pi-processes: Next Steps

The multi-extension rewrite is complete in code.

Done:

- Core `processes` extension owns the manager, tool, settings, event protocol,
  `/ps`, and `/ps:settings`.
- `processes-logs` owns `/ps:logs`.
- `processes-dock` owns `/ps:dock`, `/ps:pin`, the dock widget, and the status
  widget.
- The `process` tool supports `start`, `list`, `stop`, `output`, `update`, and
  `clear`.
- Agent steering is implemented through prompt metadata, tool result nudges, and
  `skills/pi-processes/SKILL.md`.
- `package.json` lists the three extension entry points and the restored skill.
- Import audit passes: `src/` is Pi-agnostic; UI extensions do not import the
  manager; only the core extension imports `getManager`.

Remaining before closing the rewrite:

- Investigate open issues and issues recently closed/fixed in `main` to confirm
  whether the rewritten extension handles them. Do not fix new findings during
  that audit unless a separate task asks for it.

Out of scope for the rewrite:

- Cross-session persistence — `docs/future-persistent-manager.md`.
- Cleanup hooks — `docs/future-cleanup-hooks.md` and `PLAN.md` Phase 7.
- `write` LLM tool action — `ProcessManager.writeToStdin()` remains internal.
- `logs` LLM tool action — dropped as redundant because `list` and `output`
  return log file paths.
- `debug_preview` action — intentionally removed.
