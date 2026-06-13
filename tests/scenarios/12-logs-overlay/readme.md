# Logs overlay

This scenario verifies the `/ps:logs` command from the logs extension.

## Setup

Load the local extension in Pi. Run each scenario prompt from the project root so the script paths resolve correctly.

Process start is LLM-only. Send the scenario prompt to the agent, then use the listed manual UI steps after the agent starts the processes.

## Expected result

The agent starts managed processes with the `process` tool. The user can open `/ps:logs`, switch process tabs, watch live output, search logs, filter stdout/stderr, and toggle follow mode. `/ps:logs` is logs-only; process management controls such as kill and clear belong to the future `/ps` overview UI.

## Manual checklist

- `/ps:logs` opens the logs overlay.
- `/ps:logs <process-id>` opens with that process selected.
- `Tab` and `Shift-Tab` switch processes.
- `j` scrolls toward newer output and `k` scrolls toward older output.
- Starting scroll disables follow and keeps the viewed log window stable while new output arrives.
- `g` jumps to the top and `G` jumps to the bottom.
- `/`, `Enter`, `n`, `N`, and `Esc` handle search.
- Starting a search disables follow mode.
- `s` cycles combined/stdout/stderr streams.
- `f` toggles follow mode.
- Closing the overlay unsubscribes cleanly; reopening shows fresh output.
