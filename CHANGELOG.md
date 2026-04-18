# @aliou/pi-processes

## 0.7.2

### Patch Changes

- e7cbf6b: Name tool explicitly in promptGuidelines so it makes sense in the global system prompt Guidelines section

## 0.7.1

### Patch Changes

- 36fd5c6: Update Pi packages to 0.65.0.

  Migrate widget session lifecycle handling to current Pi session events, and align custom tool rendering with current Pi renderer requirements.

## 0.7.0

### Minor Changes

- 80f81ff: perf: replace polling timers with event-driven output rendering
- a8965ad: Add runtime log watch alerts for managed processes.

  - New `logWatches` option on `process` tool `start` action
  - Watches match log lines on `stdout`, `stderr`, or `both`
  - Default one-time behavior (`repeat: false`), with optional repeat mode
  - On watch match, emit visible UI event and trigger an immediate agent turn
  - Invalid watch config (including bad regex patterns) now fails fast at start time

- 2f33586: Process lookup now uses exact ID matching only. Fuzzy name/command matching via `find()` has been removed. The `id` parameter in tool actions accepts only the process ID returned by `start` and `list`. The `/ps` list UI merges the ID and Name columns into a single "Process" column showing `name (id)`.

## 0.6.4

### Patch Changes

- 11d03ca: Ship the bundled `pi-processes` skill and improve the published package docs.
- 2bdee75: Sync process help text and docs references with the current `/ps` commands and config paths.

## 0.6.3

### Patch Changes

- e1aa8cb: update Pi deps to 0.61.0

## 0.6.2

### Patch Changes

- 705b650: bump @aliou/pi-utils-settings to ^0.10.0 (local scope fix)

## 0.6.1

### Patch Changes

- 902eccb: Remove the unused dock follow-mode keyboard shortcut (`Shift+F`) and clean up stale docs.

  - remove `toggleFollow` from dock actions and keybinding types/defaults
  - update README command docs (`/ps:pin`, `/ps:logs`, `/ps:dock show|hide|toggle`)
  - remove incorrect global shortcut docs and clarify follow mode control via settings

## 0.6.0

### Minor Changes

- 67da7e3: Add `/ps:dock`, `/ps:focus`, `/ps:logs` commands. Add deprecated `/process:*` commands. Replace status widget with log dock. Preserve ANSI colors. Fix duplicate notifications. Use proper ThemeColor type.
- 8cd4247: Exclude local implementation plan documents from version control.
- 47bd895: Split widget hook into focused modules for types, status rendering, and setup.
- 905a499: Add `write` action to write to process stdin

  The process tool now supports writing to a running process's stdin:

  - `process action=write id=proc_1 input="hello\n"` - write data to stdin
  - `process action=write id=proc_1 input="quit\n" end=true` - write and close stdin

  Useful for interactive programs, testing RPC mode, and any scenario requiring input to be sent to a background process.

- 265d8ff: Reorganize process commands into per-command directories and split settings command internals.

### Patch Changes

- 9fa2188: Restore bottom border line on log overlay
- dbcd3d1: Split commands into separate files for better organization
- d0814e6: Improve tool result display when collapsed: show last 2 output lines, first 3 processes with status. Remove redundant action/status footer on success.

## 0.5.0

### Minor Changes

- da665cd: Add opt-in blocker for background bash commands: when enabled, `bash` tool calls that would spawn a background process (`&`) are held for approval before execution.

  Fix process list column truncation on narrow terminals. Move `@mariozechner/pi-tui` to peer dependencies.

### Patch Changes

- 3ccf461: Fix TUI crash when rendered lines exceed terminal width. Add width guards to widget status line, process list panel, and process picker component.

## 0.4.7

### Patch Changes

- abcfd26: mark pi SDK peer deps as optional to prevent koffi OOM in Gondolin VMs

## 0.4.6

### Patch Changes

- be41cbd: Fix: include real source files

## 0.4.5

### Patch Changes

- 328571f: Move to standalone repository

## 0.4.4

### Patch Changes

- 18a2b3e: Fix process command shell resolution to avoid relying on `$SHELL`.

  - Keep explicit settings override via `execution.shellPath`
  - Fallback to known bash paths for consistent `-lc` behavior
  - Add/update unit tests for resolver behavior

## 0.4.3

### Patch Changes

- Updated dependencies [7df01a2]
  - @aliou/pi-utils-settings@0.4.0

## 0.4.2

### Patch Changes

- d8b1ecd: Align process tool renderCall header with shared tool header guidelines (tool/action/main args/options/long args) and keep result footer spacing consistent.

## 0.4.1

### Patch Changes

- 1167a3d: Remove auto-stream of logs widget on process start. The log stream widget should only appear when the user explicitly runs /process:stream.
- Updated dependencies [756552a]
  - @aliou/pi-utils-settings@0.3.0

## 0.4.0

### Minor Changes

- 393b9d7: Rename tool and commands from `processes` to `process`. Add /process:stream, /process:logs, /process:kill, /process:clear commands with autocomplete. Add settings support via /process:settings. Auto-stream logs widget on process start.

## 0.3.4

### Patch Changes

- 228d44d: Fix spurious "requires interactive mode" notification on TUI dismiss
- e9916ca: Strip all CSI sequences in stripAnsi, not just SGR and a few cursor codes

## 0.3.3

### Patch Changes

- b5c4cd1: Update demo video and image URLs for the Pi package browser.

## 0.3.2

### Patch Changes

- dccbf2d: Add preview video to package.json for the pi package browser.

## 0.3.1

### Patch Changes

- 7736c67: Update pi peerDependencies to 0.51.0. Reorder tool execute parameters to match new signature.

## 0.3.0

### Minor Changes

- 055fae4: Trigger agent turn on process end based on alert flags. Rename `notifyOnSuccess`/`notifyOnFailure`/`notifyOnKill` to `alertOnSuccess`/`alertOnFailure`/`alertOnKill`. These flags now control whether the agent gets a turn to react when a process ends, rather than just sending a silent message.

## 0.2.2

### Patch Changes

- 308278c: Fix ANSI rendering and output truncation in process tool results.

  - Strip ANSI escape codes from tool output rendering to prevent background color artifacts.
  - Show "ANSI escape codes were stripped from output" warning when codes were present.
  - Truncate output sent to agent context (200 lines / 50KB tail) to avoid flooding context window.
  - Append full log file paths in truncation notice.
  - Fix widget crash when many processes exceed terminal width.
  - Fix /processes panel crash from header scroll suffix and long process names.

## 0.2.1

### Patch Changes

- 5f27afd: Bump to Pi v0.50.0.

## 0.2.0

### Minor Changes

- 6477f44: Major refactor for Unix-correct process lifecycle and event-driven architecture.

  Breaking changes:

  - Unix-only: extension now disables itself on Windows with a UI warning
  - `start` action now requires explicit `name` parameter (no auto-inference)

  New features:

  - Process group signals (SIGTERM/SIGKILL) for reliable termination
  - New process statuses: `terminating`, `terminate_timeout`
  - Event-driven manager API (`process_started`, `status_changed`, `ended`)
  - Widget and TUI are now event-driven (no polling)

  Improvements:

  - Immediate SIGKILL on shutdown for fast pi exit
  - Spawns via `/bin/bash -lc` with detached process groups
  - Process-group liveness checks
  - Codebase restructured: types in `constants/`, utils in `utils/`, tool actions split

## 0.1.1

### Patch Changes

- a0cecd3: Migrate from overlay to full-screen editor-replacing view. Remove vendored tui-utils build step.

## 0.1.0

### Minor Changes

- 626f610: Initial release for the processes extension.
