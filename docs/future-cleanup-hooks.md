# Future Cleanup Hooks

This document captures the post-rewrite design for generic cleanup hooks in `pi-processes`.

This is not part of the current multi-extension rewrite. Finish the rewrite first, then implement this feature against the final architecture.

## Problem

Some managed commands are not the whole workload. They may start, control, tail, or connect to something else. Stopping the managed process can therefore stop only the visible wrapper while leaving the underlying work unchanged.

This is not specific to remote commands or web servers. It can happen with daemons, services, containers, workers, log tailers, command wrappers, and other process-control tools.

## Non-goals

- No remote runner abstraction.
- No port-specific model.
- No automatic destructive cleanup inferred from command text.
- No special-case handling for a specific transport or framework.
- No tmux/session abstraction.

## Tool Data Model

`process start` should accept an optional `cleanup` object:

```ts
cleanup?: {
  command: string;
  timeoutMs?: number;
}
```

Rules:

- `cleanup` is optional.
- If `cleanup` is present, `cleanup.command` is required.
- `cleanup.timeoutMs` is optional. Decide the default during implementation.
- Cleanup commands run with the same working directory as the original process by default.
- Cleanup output is stored in the same process logs, with clear cleanup markers.
- There is no `onFailure` option. Cleanup failure is always reported.

## Stop Semantics

When cleanup exists, stopping should be a two-step lifecycle:

1. Stop the managed process group using existing manager behavior.
2. Run the cleanup command.

The stop result succeeds only if both steps succeed.

If cleanup exits non-zero or times out, the stop result fails. The result should only state that cleanup failed or timed out. It should not speculate about what remains running.

Example:

```text
Stopped worker-tail (proc_4).
Cleanup command failed with exit code 1.
```

## Architecture

Keep cleanup in the core extension layer first, not in `src/manager`.

Likely files:

```text
extensions/processes/cleanup/
  registry.ts
  run-cleanup.ts
  stop-with-cleanup.ts
```

The cleanup registry stores cleanup config by process id, similar to the notification registry.

The shared stop helper should be used by:

- `process stop`
- `/ps:kill` through the core command protocol
- future UI stop actions

## Updating Cleanup After Start

A later part of this feature should let the agent or user attach, replace, or possibly remove cleanup metadata for an already-running process.

This is needed because a future nudge system may detect a command that likely needs cleanup only after the command has already started.

Potential model:

```ts
process update {
  id: string;
  cleanup?: {
    command: string;
    timeoutMs?: number;
  } | null;
}
```

Open question: should users get a slash command for adding cleanup to an existing process?

## Future Command Nudging

After explicit cleanup exists, add a separate feature that detects commands that might need cleanup and warns the agent/user when no cleanup is registered.

This detection must be advisory only. It must not infer or execute cleanup.

Potential warning:

```text
This command may start or control work outside the managed process. Consider adding a cleanup command so stop can clean it up explicitly.
```

This warning should be visible both in the tool result for the LLM and in the user-facing UI.

## Open Questions

1. Should cleanup run on session shutdown/reload, or only on explicit stop actions?
2. What should the default cleanup timeout be?
3. Should cleanup run for already-finished processes?
4. Should cleanup metadata be removable with `cleanup: null`?
5. Should stop-failure notifications include cleanup output?
