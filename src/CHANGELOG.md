# @aliou/pi-processes

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
