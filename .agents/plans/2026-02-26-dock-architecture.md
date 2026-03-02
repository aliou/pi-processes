---
date: 2026-02-26
title: Dock Architecture
directory: /Users/alioudiallo/code/src/pi.dev/pi-processes
project: pi-processes
status: pending
dependencies: []
dependents: [commands-cleanup]
---

# Dock Architecture

## Goal / Overview

The current architecture has two structural problems that cause real bugs and make the
code hard to reason about:

1. **`DockStateManager` is a second event bus.** It's a 180-line reactive state class
   that emits change events. `widget.ts` subscribes to both `ProcessManager` and
   `DockStateManager` independently. This means every dock state change ripples through
   two systems before anything renders. An oracle review called this out as "multiple
   overlapping state machines that don't compose cleanly."

2. **`LogDockComponent` is re-created on every state update.** In `widget.ts`,
   `updateWidget()` always calls `ctx.ui.setWidget()` with a factory that disposes and
   recreates the dock component. This destroys all viewer state (including follow flags,
   scroll position, cached colors) on every process event. This is the root cause of the
   dock follow-state-loss bug reported by the user.

**Goal: collapse `DockStateManager` into plain mutable state inside `widget.ts`, and
make `LogDockComponent` persistent (created once, updated via a method).**

After this plan:
- `src/state/dock-state.ts` is deleted
- `DockStateManager` class no longer exists
- `widget.ts` owns all dock state as a plain object and an exported `DockActions` interface
- `LogDockComponent` is created once per session and receives updates via `update()`
- `LogDockComponent` no longer subscribes to `DockStateManager` (the subscription was
  only needed to trigger re-renders; `update()` handles that now)

The `commands-cleanup` plan depends on this one because it changes the interface that
commands receive (`DockActions` replaces `DockStateManager`).

---

## Files to change

| File | Change |
|---|---|
| `src/state/dock-state.ts` | **Delete** |
| `src/hooks/widget.ts` | Major rewrite — owns plain dock state, exports `DockActions` |
| `src/components/log-dock-component.ts` | Add `update()` method, remove DockStateManager dependency |
| `src/index.ts` | Remove `DockStateManager` instantiation, receive `dockActions` from hooks |
| `src/hooks/index.ts` | Update return type to include `dockActions` |
| `src/commands/index.ts` | Accept `DockActions` instead of `DockStateManager` |
| `src/commands/ps-command.ts` | Accept `DockActions` |
| `src/commands/ps-focus-command.ts` | Accept `DockActions` |
| `src/commands/ps-kill-command.ts` | Accept `DockActions` |
| `src/commands/ps-dock-command.ts` | Accept `DockActions` |
| `src/commands/ps-list-command.ts` | Accept `DockActions` (will be removed in commands-cleanup plan) |

---

## New interfaces

Define these in `src/hooks/widget.ts` (not in a separate file — the state is local to
the widget module). Export only `DockActions`.

```ts
// Internal to widget.ts — not exported
type DockVisibility = "hidden" | "collapsed" | "open";

interface DockState {
  visibility: DockVisibility;
  followEnabled: boolean;
  focusedProcessId: string | null;
}

// Exported — the interface that commands receive
export interface DockActions {
  getFocusedProcessId(): string | null;
  isFollowEnabled(): boolean;
  setFocus(id: string | null): void;
  expand(): void;
  collapse(): void;
  hide(): void;
  toggle(): void;
  toggleFollow(): void;
}
```

Note: `DockVisibility` and `DockState` remain as types (they're useful for
the dock component), but the *class* `DockStateManager` is gone. Export `DockVisibility`
from `widget.ts` for use by `LogDockComponent`.

---

## `widget.ts` rewrite

### State and actions

Replace the `DockStateManager` import and usage with:

```ts
// Internal state — plain mutable object
const dockState: DockState = {
  visibility: "hidden",
  followEnabled: config.follow.enabledByDefault,
  focusedProcessId: null,
};
```

Implement `DockActions` as a plain object after `updateWidget` is defined:

```ts
const dockActions: DockActions = {
  getFocusedProcessId: () => dockState.focusedProcessId,
  isFollowEnabled: () => dockState.followEnabled,

  setFocus(id) {
    dockState.focusedProcessId = id;
    if (id && dockState.visibility === "hidden") dockState.visibility = "open";
    updateWidget();
  },

  expand() {
    dockState.visibility = "open";
    updateWidget();
  },

  collapse() {
    dockState.visibility = "collapsed";
    updateWidget();
  },

  hide() {
    dockState.visibility = "hidden";
    updateWidget();
  },

  toggle() {
    if (dockState.visibility === "hidden") dockState.visibility = "collapsed";
    else if (dockState.visibility === "collapsed") dockState.visibility = "open";
    else dockState.visibility = "collapsed";
    updateWidget();
  },

  toggleFollow() {
    dockState.followEnabled = !dockState.followEnabled;
    updateWidget();
  },
};
```

### Persistent component

Add two variables to the `setupProcessWidget` closure:

```ts
let logDockComponent: LogDockComponent | null = null;
let logDockComponentTui: { requestRender(): void } | null = null;
```

In `updateWidget`, replace the current "always re-create" logic with:

```ts
// Dock widget
if (dockState.visibility === "hidden") {
  latestContext.ui.setWidget(LOG_DOCK_WIDGET_ID, undefined);
  if (logDockComponent) {
    logDockComponent.dispose();
    logDockComponent = null;
    logDockComponentTui = null;
  }
  return;
}

const mode = dockState.visibility; // "collapsed" | "open"
const height = mode === "collapsed" ? 3 : config.widget.dockHeight;

if (logDockComponent && logDockComponentTui) {
  // Component already exists — just update its state. No setWidget call needed.
  logDockComponent.update({
    mode,
    focusedProcessId: dockState.focusedProcessId,
    dockHeight: height,
  });
} else {
  // First time showing (or after a session switch destroyed it).
  const ctx = latestContext;
  ctx.ui.setWidget(
    LOG_DOCK_WIDGET_ID,
    (tui, theme) => {
      logDockComponent = new LogDockComponent({
        manager,
        tui,
        theme,
        mode,
        focusedProcessId: dockState.focusedProcessId,
        dockHeight: height,
      });
      logDockComponentTui = tui;
      return logDockComponent;
    },
    { placement: "aboveEditor" },
  );
}
```

### Session switch handling

On `session_switch`, the TUI context changes. The old component holds a reference to the
old TUI and must be disposed. Reset:

```ts
pi.on("session_switch", async (_event, ctx) => {
  // Destroy old component — new TUI context means we must recreate it.
  if (logDockComponent) {
    logDockComponent.dispose();
    logDockComponent = null;
    logDockComponentTui = null;
  }
  latestContext = ctx;
  updateWidget();
});
```

### Process event handler

The auto-show/hide and focus-on-exit logic currently delegates to `DockStateManager`
methods. Move it inline:

```ts
manager.onEvent((event) => {
  if (event.type === "process_started") {
    // Auto-show dock when first process starts and follow is enabled.
    if (dockState.followEnabled && dockState.visibility === "hidden") {
      dockState.visibility = "collapsed";
    }
  }

  if (event.type === "process_ended") {
    // Unfocus if the focused process ended.
    if (dockState.focusedProcessId === event.info.id) {
      dockState.focusedProcessId = null;
    }
    // Auto-hide when last running process ends and follow is enabled.
    const running = manager.list().filter((p) => LIVE_STATUSES.has(p.status));
    if (running.length === 0 && config.follow.autoHideOnFinish && dockState.followEnabled) {
      dockState.visibility = "hidden";
    }
  }

  updateWidget();
});
```

Note: `process_status_changed` is not subscribed to here. It has no subscribers
currently (a dead event identified in the oracle review). See the **dead event cleanup**
section below.

### Return value

Return `dockActions` alongside `update`:

```ts
return { update: updateWidget, dockActions };
```

---

## `LogDockComponent` changes

### Remove DockStateManager dependency

Remove `dockState: DockStateManager` from `LogDockOptions` and from the class.
Remove the `this.unsubscribeDock` subscription (the subscription was purely for
triggering re-renders — `update()` takes over that role).

```ts
// REMOVE from LogDockOptions:
dockState: DockStateManager;

// REMOVE from constructor:
this.unsubscribeDock = this.dockState.subscribe(() => {
  this.tui.requestRender();
});

// REMOVE from dispose():
this.unsubscribeDock?.();
```

### Add `mode` and `focusedProcessId` fields

```ts
private mode: "collapsed" | "open";
private focusedProcessId: string | null;
```

These replace the `dockState.getState()` calls inside `render()`.

Update `LogDockOptions`:
```ts
interface LogDockOptions {
  manager: ProcessManager;
  tui: { requestRender: () => void };
  theme: Theme;
  mode: "collapsed" | "open";
  focusedProcessId: string | null;
  dockHeight?: number;
}
```

### Add `update()` method

```ts
update(opts: {
  mode: "collapsed" | "open";
  focusedProcessId: string | null;
  dockHeight: number;
}): void {
  this.mode = opts.mode;
  this.focusedProcessId = opts.focusedProcessId;
  this.dockHeight = opts.dockHeight;
  this.tui.requestRender();
}
```

### Update `render()` to use fields

In `render()`, replace:
```ts
const state = this.dockState.getState();
if (state.visibility === "hidden") return [];
if (state.visibility === "collapsed") return this.renderCollapsed(width);
return this.renderOpen(width);
```

With:
```ts
if (this.mode === "collapsed") return this.renderCollapsed(width);
return this.renderOpen(width);
```

In `renderOpen()`, replace `state.focusedProcessId` with `this.focusedProcessId`.

In `renderCollapsed()`, replace `dockState.getState().followEnabled` with a
`followEnabled` field (passed in via `update()` or constructor). Add it to both
`LogDockOptions` and `update()`:

```ts
// Add to options and update():
followEnabled: boolean;
```

---

## `index.ts` changes

Remove:
```ts
import { DockStateManager } from "./state/dock-state";
// ...
const dockState = new DockStateManager(config.follow.enabledByDefault);
```

Update hook setup to receive `dockActions`:
```ts
const { update: updateWidget, dockActions } = setupProcessesHooks(
  pi,
  manager,
  config,
);

setupProcessesCommands(pi, manager, dockActions);
```

Note: `dockState` is no longer passed to `setupProcessesHooks` — the initial
`followEnabled` value is read from `config` inside `widget.ts`.

---

## `hooks/index.ts` changes

Update `setupProcessesHooks` signature — remove `dockState` parameter, return
`dockActions`:

```ts
export function setupProcessesHooks(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
): { update: () => void; dockActions: DockActions }
```

Pass `config` to `setupProcessWidget` (currently it already receives `config`).
Remove `dockState` from the parameter list.

---

## Dead event cleanup (bonus, do while in this file)

`process_status_changed` is emitted by `ProcessManager.transition()` but has no
subscribers anywhere in the codebase. It adds noise to the `ManagerEvent` union type.

Remove it:

**`src/constants/types.ts`** — remove from `ManagerEvent`:
```ts
// REMOVE:
| { type: "process_status_changed"; info: ProcessInfo; prev: ProcessStatus }
```

**`src/manager.ts`** — `transition()` still emits `process_status_changed` before
emitting `process_ended`. Remove those two lines; keep only the `process_ended` emit
(and the `process_started` emit in `start()`):

```ts
private transition(managed: ManagedProcess, next: ProcessStatus): void {
  if (managed.status === next) return;
  managed.status = next;
  // REMOVED: emit process_status_changed

  if (next === "exited" || next === "killed") {
    this.emit({ type: "process_ended", info: this.toProcessInfo(managed) });
  }

  this.ensureWatcherRunning();
  this.stopWatcherIfIdle();
}
```

---

## Implementation order

- [ ] 1. Update `src/constants/types.ts` — remove `process_status_changed` from `ManagerEvent`
- [ ] 2. Update `src/manager.ts` — remove `process_status_changed` emit in `transition()`
- [ ] 3. Rewrite `src/hooks/widget.ts`
  - [ ] Replace DockStateManager usage with plain `dockState` object
  - [ ] Implement `DockActions` object
  - [ ] Make `LogDockComponent` persistent (create once, call `update()` after)
  - [ ] Move auto-show/hide/unfocus logic inline into the process event handler
  - [ ] Handle session_switch: dispose and null out component
  - [ ] Return `dockActions` from `setupProcessWidget`
- [ ] 4. Update `src/hooks/index.ts` — remove `dockState` param, return `dockActions`
- [ ] 5. Update `src/components/log-dock-component.ts`
  - [ ] Remove `DockStateManager` from options and constructor
  - [ ] Add `mode`, `focusedProcessId`, `followEnabled` fields
  - [ ] Add `update()` method
  - [ ] Update `render()`, `renderOpen()`, `renderCollapsed()` to use fields
  - [ ] Remove `unsubscribeDock` subscription
- [ ] 6. Update `src/index.ts` — remove `DockStateManager`, pass `dockActions` to commands
- [ ] 7. Update `src/commands/index.ts` — accept `DockActions` instead of `DockStateManager`
- [ ] 8. Update each command file that received `dockState: DockStateManager`:
  - [ ] `ps-command.ts` — use `dockActions.setFocus()`
  - [ ] `ps-focus-command.ts` — use `dockActions.setFocus()`
  - [ ] `ps-kill-command.ts` — use `dockActions.getFocusedProcessId()` and `dockActions.setFocus(null)`
  - [ ] `ps-dock-command.ts` — use `dockActions.expand()`, `dockActions.hide()`, `dockActions.toggle()`
  - [ ] `ps-list-command.ts` — use `dockActions.setFocus()` (this file will be removed in `commands-cleanup`)
- [ ] 9. Delete `src/state/dock-state.ts`
- [ ] 10. `pnpm typecheck && pnpm lint` — fix any issues

---

## Error handling / edge cases

- **Session switch while dock is visible**: the old component must be disposed and set to
  null before the new context arrives. The `session_switch` handler does this.
  `updateWidget()` is called after, which re-creates via the `setWidget` factory path.
- **`update()` called before component is mounted**: can't happen because `update()` is
  only called from `updateWidget()`, which only calls it when `logDockComponent !== null`.
- **Visibility going from open to hidden while component exists**: `updateWidget()` calls
  `setWidget(id, undefined)` to remove the widget from the UI, then disposes the
  component. This is the correct order — don't call `dispose()` before removing from UI.
- **`followEnabled` in collapsed render**: currently `renderCollapsed()` shows
  `follow:on / follow:off`. This still needs to come from somewhere after removing
  DockStateManager. Pass it via the `update()` call alongside `mode`.
- **`cycleFocus` on the old DockStateManager**: this method is used inside `renderOpen()`
  to show which process is focused. After removal, the dock just reads
  `this.focusedProcessId` directly. The `cycleFocus` keyboard shortcut in the dock (if
  any) should instead call `dockActions.setFocus()` — but actually, looking at the current
  dock code, `handleInput` returns `false` (dock does not handle any keyboard input
  currently). No change needed.

---

## Testing strategy

1. `pnpm typecheck` — zero errors
2. `pnpm lint` — zero errors
3. Manual: start a process, observe dock auto-shows (if follow enabled).
4. Manual: kill the process, observe dock auto-hides.
5. Manual: `/ps:focus <name>` — dock must expand and stay on that process.
6. Manual: press `f` in dock (if the dock accepts keyboard — currently it returns false,
   so this is a no-op; the follow toggle in the dock is currently unused).
7. **Critical**: start a running process, observe dock. Trigger a second process start
   (which fires `process_started`, which used to re-create the component). Verify dock
   does NOT flash or lose scroll position.
8. Manual: switch sessions (`ctrl+s` or however your setup works) — verify dock
   correctly rebuilds itself with the new TUI context.

---

## Decision points

- **Why not keep DockStateManager as a thin wrapper?** The oracle was explicit: it adds a
  second event bus, and the "subscribe" pattern is only needed to call `updateWidget()`.
  Since `dockActions` methods call `updateWidget()` directly, the observer pattern buys
  nothing and adds indirection.
- **Why store dock state in widget.ts closure rather than a top-level module?** Because
  the state is entirely a UI concern. ProcessManager is the source of truth for process
  state; the dock is just a view. Keeping it in the widget module makes the boundary
  clear.
- **`DockVisibility` type**: keep as a named type (not inline strings) for readability.
  Export it so `LogDockComponent` can use it in the `update()` signature.
- **`process_status_changed` removal**: zero subscribers, pure dead code. Removing it
  now while we're already touching the event system is the right time.

---

## Rejected approaches

- **Keep DockStateManager but remove the subscribe mechanism**: still leaves the two
  separate state machines problem. The class itself adds indirection.
- **Make LogDockComponent a singleton**: singleton state is harder to test and harder to
  reset on session switch. The closure approach is cleaner.
- **Poll from LogDockComponent instead of using update()**: polling is already used for
  log file reads (500ms); having the component also poll for state changes would be
  redundant and slow to react to user actions.
