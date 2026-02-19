# pi-processes

Public Pi extension for managing background processes.

## Stack

- TypeScript (strict mode), pnpm 10.26.1, Biome, Changesets

## Scripts

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm changeset`

## Structure

- `src/index.ts` - entry, `src/manager.ts` - process manager, `src/config.ts` - config loader, `src/constants/` - types/constants, `src/commands/` - slash commands + settings, `src/tools/` - tool/actions, `src/hooks/` - event hooks, `src/components/` - TUI, `src/utils/` - helpers, `src/test/` - test scripts
