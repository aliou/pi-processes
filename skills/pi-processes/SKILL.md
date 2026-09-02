---
name: pi-processes
description: Manage long-running commands in the background with the process tool. Use when a task needs a dev server, test watcher, build watcher, local API, or log tail to keep running while the conversation continues.
---

# pi-processes

Use this skill when work needs a long-running command to stay alive while Pi continues with other steps.

## Prefer this workflow

- Use the `process` tool for long-running commands.
- Avoid shell background patterns when the process tool fits.
- Give processes stable, clear names.
- Continue the task after starting a process instead of waiting on it.
- Never poll: do not call `output` or `list` in a loop, sleep, or run a watcher command. Completion and alert notices reach you mid-turn as soon as they fire.
- Inspect output or log files only when a notice or the task needs them.
- Kill processes that are no longer useful. Finished entries are pruned automatically; `clear` is only for tidying early.

## Good fits

- `pnpm dev`
- `npm run server`
- `pnpm test --watch`
- `tail -f <logfile>`
- local preview or build watchers

## Typical flow

1. Start the long-running command with a clear name.
2. Continue the main task.
3. Set `alertOnSuccess` when you must react to a clean exit; failures alert by default. The notice arrives mid-turn.
4. Inspect `output` or `logs` when a notice says something needs attention.
5. Kill the process when it is no longer needed.

## Notes

- Users can inspect and manage running processes from `/ps`.
- Use `write` when a process expects stdin input.
- Use `output` for a quick tail and `logs` when the full log files are more useful.
