# pi-processes

Public Pi package for managing background processes. Exposes multiple Pi extensions.

## Tool and command audience

The `process` tool and all `/ps:*` commands are for **LLM use only**, not for users directly. Users can monitor processes via `/ps:logs` and kill them via `/ps:list`, but they should never be the ones starting processes -- that is the agent's job.

During UI tests that require processes to be running, either give the user a prompt to send to the agent (which will start the processes via the `process` tool), or use tmux to drive it programmatically. Never instruct the user to run shell commands manually.

## Stack

- TypeScript (strict mode), pnpm 10.26.1, Biome, Changesets

## Scripts

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm changeset`

## Structure

- `src/` - pi-agnostic process management (manager, types, protocol, utils). Zero pi imports.
- `extensions/processes/` - core extension: tool registration, settings, hooks, event bridge, request/command handlers
- `extensions/processes-list/` - `/ps`, `/ps:kill`, `/ps:clear` commands and TUI components
- `extensions/processes-logs/` - `/ps:logs` command and log overlay
- `extensions/processes-dock/` - `/ps:dock`, `/ps:pin` commands, dock widget, status widget

See `PLAN.md` for the full architecture and implementation plan.
