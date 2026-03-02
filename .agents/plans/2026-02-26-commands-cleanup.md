---
date: 2026-02-26
title: Commands Cleanup
directory: /Users/alioudiallo/code/src/pi.dev/pi-processes
project: pi-processes
status: pending
dependencies: [dock-architecture]
dependents: []
---

# Commands Cleanup

## Goal / Overview

The current command set is confusing. There are 7 slash commands but the mental model
is unclear: `/ps` and `/ps:list` do the same thing, `/ps:focus` has a name that doesn't
communicate what it does, and `/ps:dock` with sub-arguments (`on`, `off`, `expanded`)
is hard to discover.

The oracle/reviewer identified command/tool duplication as a complexity driver. This plan
does **not** merge commands into tools — that distinction is correct (commands are for
humans, tool actions are for the LLM). The goal is to make the human-facing commands
coherent.

This plan **depends on `dock-architecture`** because that plan changes the interface
commands receive (`DockActions` instead of `DockStateManager`). Do not execute this plan
first.

### Changes summary

| Before | After | Reason |
|---|---|---|
| `/ps` | `/ps` (keep) | Main process panel |
| `/ps:list` | **remove** | Exact duplicate of `/ps` |
| `/ps:focus [id]` | `/ps:pin [id]` | "pin" communicates the dock behavior better |
| `/ps:dock [on/off/expanded]` | `/ps:dock [show/hide/toggle]` | Clearer sub-command names |
| `/ps:logs [id]` | `/ps:logs [id]` (keep, improve description) | Correct name |
| `/ps:kill [id]` | `/ps:kill [id]` (keep) | Clear |
| `/ps:clear` | `/ps:clear` (keep) | Clear |

---

## Files to change

| File | Change |
|---|---|
| `src/commands/ps-list-command.ts` | **Delete** |
| `src/commands/ps-focus-command.ts` | **Delete**, replaced by ps-pin-command.ts |
| `src/commands/ps-pin-command.ts` | **New** (copy of ps-focus, renamed) |
| `src/commands/ps-dock-command.ts` | Update sub-command names and descriptions |
| `src/commands/index.ts` | Remove ps-list and ps-focus registrations, add ps-pin |
| `src/commands/settings-command.ts` | Check for any references to old command names; update if present |
| `EVENTS.md` | Update command table to reflect new names |

---

## `/ps:list` removal

This command is a verbatim copy of `/ps`. It was added as a convenience alias but
creates cognitive overhead ("which one should I use?"). Remove it completely.

**Delete** `src/commands/ps-list-command.ts`.

In `src/commands/index.ts`, remove:
```ts
import { registerPsListCommand } from "./ps-list-command";
// ...
registerPsListCommand(pi, manager, dockActions);
```

Also remove the line from the header comment:
```ts
// REMOVE from comment:
// /ps:list     - Alias for /ps
```

---

## `/ps:focus` → `/ps:pin`

The word "focus" is overloaded in UIs (keyboard focus, visual focus, etc.) and doesn't
communicate "this pins the dock view to a specific process." The word "pin" is concrete
and matches the mental model: you're pinning the dock's view to a specific process.

**Create** `src/commands/ps-pin-command.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import type { DockActions } from "../hooks/widget";
import { allProcessCompletions } from "./completions";
import { pickProcess } from "./pick-process";

export function registerPsPinCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
): void {
  pi.registerCommand("ps:pin", {
    description: "Pin the dock to a specific process (shows its logs)",
    getArgumentCompletions: allProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();
      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) return;
        processId = proc.id;
      } else {
        processId = await pickProcess(ctx, manager, "Select process to pin");
        if (!processId) return;
      }

      dockActions.setFocus(processId);
    },
  });
}
```

**Delete** `src/commands/ps-focus-command.ts`.

In `src/commands/index.ts`, replace:
```ts
import { registerPsFocusCommand } from "./ps-focus-command";
// ...
registerPsFocusCommand(pi, manager, dockActions);
```

With:
```ts
import { registerPsPinCommand } from "./ps-pin-command";
// ...
registerPsPinCommand(pi, manager, dockActions);
```

---

## `/ps:dock` sub-command rename

Current sub-commands: `on`, `off`, `expanded`.
- `on` is ambiguous (on = shown, but collapsed or open?)
- `expanded` duplicates what `on` almost means
- `off` is fine but inconsistent with the others

New sub-commands: `show`, `hide`, `toggle` (no argument = toggle, same as before).

`show` → collapses the dock if hidden, expands if collapsed. Same behavior as current
`on`. Maps to `dockActions.expand()`.
`hide` → hides the dock. Maps to `dockActions.hide()`.
`toggle` → cycles `hidden → collapsed → open → collapsed`. Maps to `dockActions.toggle()`.

Update `src/commands/ps-dock-command.ts`:

```ts
export function registerPsDockCommand(
  pi: ExtensionAPI,
  dockActions: DockActions,
): void {
  pi.registerCommand("ps:dock", {
    description: "Control dock visibility: show, hide, or toggle",
    getArgumentCompletions: () => [
      { value: "show", label: "show — make the dock visible" },
      { value: "hide", label: "hide — hide the dock" },
      { value: "toggle", label: "toggle — cycle visibility" },
    ],
    handler: async (args, _ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "show") {
        dockActions.expand();
      } else if (arg === "hide") {
        dockActions.hide();
      } else if (arg === "toggle" || arg === "") {
        dockActions.toggle();
      } else {
        // Unknown sub-command — silently toggle (graceful fallback)
        dockActions.toggle();
      }
    },
  });
}
```

Note: the old `on` / `expanded` / `off` sub-commands are not kept as aliases. Anyone
using them (scripts, habits) would need to update. This is acceptable for an extension
at this stage.

---

## Improved command descriptions

Update `description` strings across all remaining commands to make the mental model
clearer. The description is shown in tab-completion and `/help`.

| Command | New description |
|---|---|
| `/ps` | `View and manage all background processes` |
| `/ps:logs [id]` | `Open log viewer for a process (search, scroll, stream filter)` |
| `/ps:pin [id]` | `Pin the dock to a specific process` |
| `/ps:kill [id]` | `Kill a running process` |
| `/ps:clear` | `Remove all finished processes from the list` |
| `/ps:dock [show\|hide\|toggle]` | `Control dock visibility` |

---

## `index.ts` header comment update

Update the block comment at the top of `src/commands/index.ts`:

```ts
/**
 * Process commands with /ps: prefix.
 *
 * /ps                       - View and manage all background processes
 * /ps:logs [id]             - Open log viewer overlay (search, scroll, stream filter)
 * /ps:pin [id]              - Pin the dock to a specific process
 * /ps:kill [id]             - Kill a running process
 * /ps:clear                 - Remove all finished processes from the list
 * /ps:dock [show|hide|toggle] - Control dock visibility
 */
```

---

## `EVENTS.md` update

Update the command table in `EVENTS.md` to reflect removals and renames. Find the
"User commands: for managing what you see" table and update it:

| Command | When to use |
|---|---|
| `/ps` | Get a full overview: see all processes, statuses, and select one to focus |
| `/ps:logs [name]` | Deep-dive into a process's logs in a floating pane with search |
| `/ps:pin [name]` | Pin the dock to a specific process |
| `/ps:dock [show\|hide\|toggle]` | Control dock visibility |
| `/ps:kill [name]` | Terminate a running process |
| `/ps:clear` | Remove finished processes from the list |

Also update the "User command flows" section to remove `/ps:list` and rename
`/ps:focus` → `/ps:pin`.

---

## Implementation order

- [ ] 1. Delete `src/commands/ps-list-command.ts`
- [ ] 2. Delete `src/commands/ps-focus-command.ts`
- [ ] 3. Create `src/commands/ps-pin-command.ts`
- [ ] 4. Update `src/commands/ps-dock-command.ts` — new sub-commands and `DockActions` signature
- [ ] 5. Update `src/commands/ps-command.ts` — update description string
- [ ] 6. Update `src/commands/ps-logs-command.ts` — update description string
- [ ] 7. Update `src/commands/ps-kill-command.ts` — update description string, ensure `DockActions` signature
- [ ] 8. Update `src/commands/ps-clear-command.ts` — update description string
- [ ] 9. Update `src/commands/index.ts` — remove ps-list/ps-focus, add ps-pin, update header comment
- [ ] 10. Update `EVENTS.md` — command table and user command flows
- [ ] 11. `pnpm typecheck && pnpm lint` — fix any issues

---

## Error handling / edge cases

- `/ps:dock` with an unrecognized argument: silently falls through to `toggle()`. This is
  the current behavior and avoids silent failures if the user typos a sub-command.
- `/ps:pin` with a finished process ID: `dockActions.setFocus()` doesn't check whether
  the process is running. The dock will show the logs of a finished process (which is
  useful — you may want to read the output after it exits). This is intentional.
- No backward-compat aliases for removed/renamed commands: the extension is not yet at a
  stable public API. If this were a published stable extension, aliases would be needed.

---

## Testing strategy

1. `pnpm typecheck` — zero errors
2. `pnpm lint` — zero errors
3. Manual: `/ps:list` — should not exist (tab-completion should not show it)
4. Manual: `/ps:focus` — should not exist
5. Manual: `/ps:pin backend` — dock should expand and pin to `backend` process
6. Manual: `/ps:dock show` — dock becomes visible
7. Manual: `/ps:dock hide` — dock hides
8. Manual: `/ps:dock` (no arg) — dock cycles through states
9. Manual: `/ps:dock on` — falls through to toggle (unrecognized arg)

---

## Decision points

- **Rename to `ps:pin` vs keeping `ps:focus`**: "pin" is more concrete and less
  overloaded than "focus." A user can understand "pin the dock to this process" without
  knowing anything about the extension's internals.
- **Keeping backward compat for old sub-commands (`on/off/expanded`)**: rejected.
  The cleaner API is worth the minor churn. The extension is in active development and
  has no external users to break.
- **Not merging `/ps:kill` and `/ps:clear` into `/ps` sub-commands**: they work from the
  command line without opening a UI, which is useful. Keep them as top-level commands.
- **Not adding a `/ps:unpin` command**: `dockActions.setFocus(null)` is implicitly done
  when the process ends. If a user wants to unpin, they can run `/ps:dock show` which
  resets to showing the default (first running) process. An explicit unpin command was
  considered but adds complexity with little benefit.

---

## Rejected approaches

- **Merging `/ps` and `/ps:logs` into one command**: they serve different purposes.
  `/ps` gives you the full management panel. `/ps:logs` gives you a search-capable log
  viewer. Conflating them would require an awkward mode switch inside the component.
- **Making `/ps:dock` a toggle-only command (remove sub-commands)**: the sub-commands
  are useful when the user wants to go directly to a specific state (e.g., in a script
  or macro). Keep them.
- **Keeping `/ps:list` as a non-UI alias that prints to console**: the extension doesn't
  currently have a non-UI text output mode for commands, and adding one for a single
  alias is not worth the complexity.
