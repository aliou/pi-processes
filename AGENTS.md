# pi-processes

Public Pi extension for managing background processes.

## Tool and command audience

The `process` tool and all `/ps:*` commands are for **LLM use only**, not for users directly. Users can monitor processes via `/ps:logs` and kill them via `/ps:list`, but they should never be the ones starting processes — that is the agent's job.

During UI tests that require processes to be running, either give the user a prompt to send to the agent (which will start the processes via the `process` tool), or use tmux to drive it programmatically. Never instruct the user to run shell commands manually.

## Stack

- TypeScript (strict mode), pnpm 10.26.1, Biome, Changesets

## Scripts

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm changeset`

## Structure

- `src/index.ts` - entry, `src/manager.ts` - process manager, `src/config.ts` - config loader, `src/constants/` - types/constants, `src/commands/` - slash commands + settings, `src/tools/` - tool/actions, `src/hooks/` - event hooks, `src/components/` - TUI, `src/utils/` - helpers, `src/test/` - test scripts
