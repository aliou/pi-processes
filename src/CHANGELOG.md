# @aliou/pi-processes

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
