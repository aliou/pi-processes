# pi-processes: Next Steps

Phases 1 through 4 (plus Phase 3 bis) of the multi-extension rewrite are
complete, and the `/ps` overview/control panel is now implemented in the core
extension. The remaining work is the `clear` LLM tool action, agent steering
guidance, and final package cleanup. Everything below is ordered by priority.

## 1. `clear` LLM tool action

Next step. Restores parity with `main` for clearing finished processes from
the tool surface.

**Scope:**

- New `process clear` action (no `id` required).
- Calls `manager.clearFinished()` through a tool-level execute path (the manager
  already owns this; `COMMAND_CLEAR` already exposes it to UI extensions).
- Emits `processes_changed` (already does).
- Renders: number cleared. Minimal result block.

**Not included:**

- `write` tool action is intentionally not planned for the rewrite.
  `ProcessManager.writeToStdin()` stays an internal API only.

## 2. Agent steering guidance

Tighten promptGuidelines and ship the skill to steer agents away from common
mistakes identified during PR #33 review.

### promptGuidelines rewrite (~5 lines)

Merge the existing 8 lines into ~5 tighter ones. Fold in:

- list before start
- use watches instead of polling output
- use `update` instead of restarting to change watches
- `output` is for targeted inspection only (not deep reads — use `read` on the
  log paths from `list`/`output`)
- do not re-summarize tool output back to the user

### Skill: `skills/pi-processes/SKILL.md`

Recreate (was removed in `58aad4b`). Expanded guidance with bad/good examples for
common mistakes:

- Polling output instead of setting watches
- Restarting instead of updating watches
- Starting duplicate processes (list first)
- Not watching for common failure patterns (EADDRINUSE, etc.)
- Re-summarizing tool output to the user
- Using `output` for deep inspection (use logs/`read` instead)
- Vague process names
- Leaving obsolete processes running

### Steering text in tool output

- Add to `formatStartDetails` when watches are active: "Continue other work;
  watch notifications will trigger follow-up."
- Add to `formatOutputDetails` when the process is still running: "Process is
  still running. Use watches instead of polling."

## 3. Final package/config cleanup

Last step, after 1-2 land.

- Update `package.json`: confirm the `extensions` array lists the three
  extensions (`processes`, `processes-logs`, `processes-dock`). The `/ps`
  panel lives in core, so it does not add a fourth entry. Remove the stale
  `pi.skills` / `files` entry pointing at the missing `./skills/pi-processes`
  directory, or restore the skill once step 3 ships the new `SKILL.md`.
- Import audit:
  - `src/` has zero imports from `@earendil-works/pi-coding-agent`,
    `@earendil-works/pi-tui`, `@aliou/pi-utils-settings`, `@aliou/pi-utils-ui`.
  - All UI extensions (`processes-logs`, `processes-dock`, and the new panel)
    have zero imports from `src/manager` or `src/get-manager`.
  - Only `extensions/processes/` imports `getManager`.
- Update `AGENTS.md` structure section to reflect the new directory layout.
- Full manual QA pass through all commands and tool actions, plus a reload test
  (start processes, reload, verify shutdown behavior).

## Parallelism

Step 1 (`clear` tool) and step 2 (steering) are independent and can be done in
parallel. Step 3 (cleanup) is last. The `/ps` overview panel is complete.

## Done

- `/ps` overview/control panel — implemented in the core `extensions/processes/`
  extension. Full-screen editor-replacement overview with a local vendored
  header-capable panel (`overview-panel.ts`), selectable fixed-height process
  rows (`processList.maxVisibleProcesses` means process-list content rows),
  sortable/filterable list, colored statuses, bounded recent-output preview,
  kill/clear actions, and dock pin/unpin via `CHANNELS.COMMAND_PIN`. Talks to
  the manager only over `pi.events` channels (`REQUEST_LIST`,
  `REQUEST_COMBINED_OUTPUT`, `COMMAND_KILL`, `COMMAND_CLEAR`, `COMMAND_PIN`) via
  `extensions/processes/client.ts`. Selection survives `CHANNELS.CHANGED`
  refreshes. Dead/finished processes cannot be newly pinned, but an already
  pinned process remains pinned if it exits. Added an "Overview panel" settings
  detail item and scenarios in `tests/scenarios/14-overview/`. Unit/render tests
  cover sorting/filtering, width safety, header layout, empty states, and
  pin/unpin behavior.

## Out of scope for the rewrite

These are tracked separately and must not block completing the rewrite:

- **Cross-session persistence** — `docs/future-persistent-manager.md`.
- **Cleanup hooks** — `docs/future-cleanup-hooks.md` and `PLAN.md` Phase 7. This
  is a post-rewrite feature: optional `process start cleanup: { command,
  timeoutMs }`, two-step stop (stop process then run cleanup), `process update`
  cleanup mutation, and an advisory command-nudging follow-up.
- **`write` LLM tool action** — `ProcessManager.writeToStdin()` exists in `src/`
  but is intentionally not exposed as a tool action in the rewrite.
- **`logs` LLM tool action** — dropped as redundant (`list`/`output` return log
  file paths).
- **`debug_preview` action** — intentionally removed.
