# pi-processes: event & interaction diagram

This document maps every actor, event, and interaction in the extension.
Read it before touching any UX or adding any command or tool action.

---

## Actors

| Actor | File | Role |
|---|---|---|
| **ProcessManager** | `src/manager.ts` | Source of truth for all processes. Spawns, tracks, and terminates child processes. Emits events. |
| **DockStateManager** | `src/state/dock-state.ts` | Visibility/focus/follow state for the dock widget. Notifies subscribers on change. |
| **widget.ts** | `src/hooks/widget.ts` | Glue layer. Subscribes to both ProcessManager and DockStateManager. Drives the two always-visible UI widgets. |
| **LogDockComponent** | `src/components/log-dock-component.ts` | Renders the dock widget. Accepts keyboard input when the dock is open. |
| **LogOverlayComponent** | `src/components/log-overlay-component.ts` | Tabbed floating log viewer. Only exists while `/ps:logs` is active. |
| **ProcessesComponent** | `src/components/processes-component.ts` | Full-screen process manager panel. Only exists while `/ps` is active. |
| **process tool** | `src/tools/index.ts` | The single LLM-facing tool. Dispatches to one of seven action handlers. |

---

## ProcessManager events

ProcessManager is the only source of events. Everything else reacts to it.

```
ProcessManager.emit()
  │
  ├─ "process_started"      → fired once when a child process is spawned
  ├─ "process_ended"        → fired once when a child process exits or is killed
  └─ "processes_changed"    → fired when the list changes for any other reason
                              (currently: after clear())
```

Subscribers (registered at boot, never removed):
- `widget.ts` via `manager.onEvent()`
- `LogOverlayComponent` via `manager.onEvent()` (only while overlay is open)
- `LogDockComponent` indirectly, via `widget.ts` re-creating it

---

## LLM tool call flows

All LLM interactions go through the single `process` tool (`process action`).

```
LLM calls process(action: "start", name, command, ...)
  → executeStart()
      → manager.start()
          → spawns child process
          → emits "process_started"
              → widget.ts: dockState.autoShow()   [hidden→collapsed if followEnabled]
              → widget.ts: updateWidget()          [re-renders status widget + dock]

LLM calls process(action: "list")
  → executeList()
      → manager.list()
      → returns snapshot of all processes (no side effects)

LLM calls process(action: "output", id)
  → executeOutput()
      → reads in-memory stdout/stderr ring buffer from manager
      → returns last N lines (no side effects)

LLM calls process(action: "logs", id)
  → executeLogs()
      → returns { stdoutFile, stderrFile, combinedFile } paths
      → LLM then uses the read tool to inspect those files directly

LLM calls process(action: "kill", id)
  → executeKill()
      → manager.kill()
          → sends SIGTERM to child process
          → eventually child exits → emits "process_ended"
              → widget.ts: dockState.handleProcessExit(id)  [unfocuses if focused]
              → widget.ts: dockState.autoHide()             [if last running + followEnabled]
              → widget.ts: updateWidget()

LLM calls process(action: "clear")
  → executeClear()
      → manager.clear()                   [removes finished processes from list]
          → emits "processes_changed"
              → widget.ts: updateWidget()
              → LogOverlayComponent: if list becomes empty → self-closes

LLM calls process(action: "write", id, input)
  → executeWrite()
      → writes to child process stdin (no event emitted)
```

---

## User command flows

```
/ps  or  /ps:list
  → opens ProcessesComponent (full-screen takeover, blocks input)
      keyboard: j/k scroll, Enter/Space select, q/Esc close
      on close with selection: dockState.setFocus(processId)  [expands dock]
      on close without selection: no side effect

/ps:logs  [id or picker]
  → picks process (inline picker if no arg)
  → opens LogOverlayComponent (floating overlay, blocks input)
      keyboard: see "Overlay keyboard" section below
      on close: overlay is destroyed, dock resumes

/ps:focus  [id or picker]
  → dockState.setFocus(processId)
      → visibility: hidden|collapsed → "open"
      → focusedProcessId = id
      → DockStateManager notifies subscribers
          → widget.ts: updateWidget()  [re-creates LogDockComponent with new focus]

/ps:kill  [id or picker]
  → manager.kill(id)
  → (same downstream as LLM kill above)

/ps:clear
  → manager.clear()
  → (same downstream as LLM clear above)

/ps:dock  [on | off | expanded | (no arg)]
  → dockState.expand() / hide() / toggleVisibility()
      → DockStateManager notifies subscribers
          → widget.ts: updateWidget()
```

---

## Process lifecycle state machine

```
             manager.start()
                   │
                   ▼
              ┌─────────┐
              │ running │ ──── output lines accumulate in ring buffer (no event)
              └─────────┘
               │        │
         SIGTERM/kill  natural exit
               │        │
               ▼        ▼
         ┌────────────────┐
         │  terminating   │  (brief: waiting for graceful exit)
         └────────────────┘
               │        │
           timeout    exited
               │
               ▼
        ┌──────────────────┐
        │ terminate_timeout│  → then SIGKILL
        └──────────────────┘
               │
               ▼
           ┌────────┐
           │ killed │
           └────────┘

Any terminal state (exited / killed) → emits "process_ended"
manager.clear() removes processes in terminal states → emits "processes_changed"
```

---

## Dock state machine

```
DockStateManager.visibility:

      hidden ◄──── autoHide() ◄─── last running process ends (followEnabled)
        │
     autoShow() ◄── process_started (followEnabled)
     /ps:dock on
        │
        ▼
    collapsed  (status bar only, N lines tall)
        │
     /ps:dock expanded
     /ps:focus [id]
     user toggles in ProcessesComponent
        │
        ▼
      open  (full dock height, log content visible)

Any visibility change → widget.ts.updateWidget() → dock widget re-created
```

---

## Dock widget: always-visible UI (no overlay)

The dock widget is permanently mounted below the editor when visible. It is
not a command — it just exists as long as `visibility !== "hidden"`.

```
DockStateManager change  ─────────────────────────────────────┐
ProcessManager event  ─────────────────────────────────────────┤
                                                               ▼
                                                     widget.ts.updateWidget()
                                                               │
                                     ┌─────────────────────────┤
                                     │                         │
                                     ▼                         ▼
                              status widget             dock widget
                          (single line above           LogDockComponent
                           editor: running             (above editor,
                           process summary)             N lines tall)
```

LogDockComponent polling: 300ms interval, reads log files directly.
No event is emitted when a process writes output — only polling catches it.

---

## LogDockComponent keyboard (when dock is "open")

The dock is a widget, not an overlay. It receives keyboard input only when
pi routes input to it (implementation detail of pi-tui widget focus).

```
Tab / Shift-Tab    cycle focus between processes
f                  toggle follow mode for focused process
(no search, no scroll keybindings — those live in the overlay)
```

---

## LogOverlayComponent keyboard (when /ps:logs is active)

The overlay is a floating pane on top of everything. It captures all input.

```
Normal mode:
  Tab / Shift-Tab   cycle to next / prev process tab
  g / G             scroll to top / bottom
  j / k             scroll up / down one line
  d / u             scroll half-page
  f                 toggle follow mode for current tab
  s                 cycle stream filter: combined → stdout → stderr → combined
  /                 enter search mode
  q / Esc           close overlay

Search mode (bottom line replaced):
  (typing)          refine search query
  Enter             apply search, return to normal mode
  n / N             next / prev match  (only visible in search mode)
  Esc               clear search and return to normal mode
```

---

## What each command/tool is for (the intended mental model)

### Always visible (no command needed)
| Widget | What it shows |
|---|---|
| Status widget | One-line summary of all processes, below the editor |
| Dock widget | Log tail for the focused process (or first running), above the editor |

### User commands: for managing what you see
| Command | When to use |
|---|---|
| `/ps` | Get a full overview: see all processes, statuses, and select one to focus |
| `/ps:logs [name]` | Deep-dive into a process's logs in a floating pane with search |
| `/ps:focus [name]` | Pin the dock to a specific process |
| `/ps:dock [on\|off\|expanded]` | Control dock visibility without a picker |
| `/ps:kill [name]` | Terminate a running process |
| `/ps:clear` | Remove finished processes from the list |

### LLM tool actions: for the model to manage processes
| Action | What it does |
|---|---|
| `start` | Spawn a background command, get back an id |
| `list` | See all processes and their statuses |
| `output` | Read recent stdout/stderr from memory (fast, limited) |
| `logs` | Get file paths to read full logs with the `read` tool |
| `kill` | Terminate a process by id or name |
| `clear` | Remove all finished processes |
| `write` | Send input to a running process's stdin |

---

## Wiring diagram (boot sequence)

```
index.ts
  │
  ├─ configLoader.load()
  ├─ new ProcessManager()
  ├─ new DockStateManager()
  │
  ├─ setupProcessesHooks(pi, manager, config, dockState)
  │     ├─ setupCleanupHook()       kills all processes on session end
  │     ├─ setupProcessEndHook()    sends LLM a turn when alertOnSuccess/Failure triggers
  │     ├─ setupBackgroundBlocker() intercepts shell commands (if configured)
  │     ├─ setupProcessWidget()     ← subscribes to manager + dockState, drives widgets
  │     └─ setupMessageRenderer()   renders LLM tool call results
  │
  ├─ setupProcessesCommands(pi, manager, dockState)
  │     registers: /ps /ps:list /ps:logs /ps:focus /ps:kill /ps:clear /ps:dock
  │
  └─ setupProcessesTools(pi, manager)
        registers: process tool (start/list/output/logs/kill/clear/write)
```
