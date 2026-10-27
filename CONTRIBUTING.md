# Contributing

## Scope

`README.md` is for users.

Keep development details, testing notes, internal tool guidance, and docs build details in this file.

## Development

Requirements:

- Node.js `22.19.0` or newer
- pnpm `11.5.1`

Install dependencies:

```bash
pnpm install
```

Run checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

## Repository layout

Component roles; run `ls` for the full tree.

- `src/` - Pi-agnostic process management. Zero Pi imports.
- `extensions/processes/` - core extension: the `process` tool, settings, lifecycle hooks, event bridge, notifications, and the `/ps` overview panel
- `extensions/processes-logs/` - `/ps:logs` command and log overlay
- `extensions/processes-dock/` - dock widget, status widget, and the `/ps:dock` / `/ps:pin` commands
- `extensions/shared/` - UI helpers shared by all three extensions
- `skills/` - package skills shipped to Pi
- `.agents/skills/` - repo-only skills for development workflows

## Package metadata

Target one Pi release at a time: the packages it bundles are pinned in `devDependencies` and bumped together when retargeting.

Pi bundles core packages for extensions. Keep direct imports of these packages in `peerDependencies` with `"*"` ranges and exact local versions in `devDependencies`:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

Keep normal third-party runtime dependencies in `dependencies`.

## Internal behavior

This extension is mainly for agent-managed background processes.

Typical flow:

1. Pi starts a long-running command in the background.
2. Pi continues other work.
3. The user watches, pins, or kills the process from the UI.
4. Pi inspects output or logs when needed.

Use the `process` tool for long-running commands such as dev servers, test watchers, build watchers, and log tails.

Avoid shell background patterns when the process tool fits.

Background command blocking is optional. It is controlled by `interception.blockBackgroundCommands`.

## Testing

Useful local checks:

```bash
pnpm lint
pnpm typecheck
```

Useful manual process scripts live under `tests/e2e/scripts/`:

```bash
./tests/e2e/scripts/continuous-output.sh   # long-running stdout
./tests/e2e/scripts/error-log.sh            # interleaved info/error on stdout+stderr
./tests/e2e/scripts/exited-task.sh          # finite, exits 0
./tests/e2e/scripts/crash-on-file.sh <name>  # waits for a marker file then crashes
```

See `.agents/skills/pi-processes-testing/SKILL.md` for the full manual QA workflow and the complete fixture script reference.

## Docs conventions

### README

Keep `README.md` focused on user outcomes:

- what the extension does
- how users interact with it
- slash commands and UI behavior
- troubleshooting

Avoid putting these in `README.md`:

- dev commands
- test commands
- internal architecture details
- detailed tool-call schemas
- release workflow notes

### Docs page build

The docs page is generated from `README.md` by an external build, not in this repo. Keep `README.md` self-contained with only standard markdown.

## Future design notes

Unimplemented design notes live in `docs/`:

- `docs/future-cleanup-hooks.md` - planned `cleanup` support for `process start` / `process stop`
- `docs/future-persistent-manager.md` - planned cross-session process persistence

These describe intended future behavior, not current behavior. Active implementation work goes under `.agents/plans/`.
