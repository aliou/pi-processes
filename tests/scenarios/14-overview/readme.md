# Overview panel

These scenarios verify the `/ps` overview/control panel from the core processes extension.

## Setup

Load the local extension in Pi. Run each scenario prompt from the project root so the script paths resolve correctly.

Process start is LLM-only. Send the scenario prompt to the agent, then use the listed manual UI steps after the agent starts the processes.

## Expected result

The agent starts managed processes with the `process` tool. The user opens `/ps` and gets a full-screen overview replacing the editor: a selectable list of all processes with status dots, a command preview, a recent-output preview pane, and inline actions. The panel talks to the manager exclusively over `pi.events` protocol channels (`REQUEST_LIST`, `REQUEST_COMBINED_OUTPUT`, `COMMAND_KILL`, `COMMAND_CLEAR`, `COMMAND_PIN`), so it imports no manager code.

## Manual checklist

- `/ps` opens a full-screen panel (round border, "Processes" title) replacing the editor.
- Each row shows status dot, name, id, status, runtime, and command preview.
- `j/k` or arrows move the selection; the selected row is highlighted and stays visible when it scrolls off-screen.
- `J/K` scroll the recent-output preview pane; `g/G` jump to top/bottom.
- `s` cycles sort (status -> started -> name); the header chips show the current sort.
- `f` cycles filter (all -> running -> finished); the header chips show the current filter.
- `/` opens a quick name filter; `enter` applies, `esc` clears.
- `enter` pins the selected process to the dock (if the dock extension is loaded) and expands it.
- `enter` on a process when the dock is not loaded shows `pin (dock not loaded)` in the footer.
- `x` kills the selected process; the list updates via `CHANNELS.CHANGED`.
- `c` clears finished processes immediately; the list updates via `CHANNELS.CHANGED`.
- `q` or `esc` closes the panel and restores the editor.
- Selection survives a `CHANNELS.CHANGED` refresh (start/stop/clear) without resetting to the top.
- With no processes, the panel shows a centered empty state.
- Without a UI, `/ps` prints a plain tab-separated process list to the console.
