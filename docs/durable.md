# Durable process extension

`@aliou/pi-processes/durable` is a native extension for pi-durable on macOS and
Linux. It registers the `process` tool, a prompt section, and a background
`ProcessTask`. The host installs it in a native registry and owns notification
delivery.

## Installation

```bash
npm install @aliou/pi-processes @earendil-works/pi-durable@1.0.1
```

The package declares durable as an optional peer with an exact development
version. The integration is tested against 1.0.1. Importing it does not require
pi-coding-agent or pi-tui. The package also ships the source extensions and skill
declared by its `pi` manifest for normal `pi install` use.

```typescript
import { createProcessExtension } from "@aliou/pi-processes/durable";
import { createRegistry } from "@earendil-works/pi-durable";

const extension = createProcessExtension({
  cwd: process.cwd(),
  onNotification(notification) {
    // Queue host delivery to notification.conversationId.
    console.log(notification);
  },
});
const registry = createRegistry();
registry.install(extension);
// Pass registry to Harness.open(). Close the Harness before extension.dispose().
```

`examples/durable.ts` runs a faux-model Harness, schedules a command, records
addressed passive notifications, inspects output through the native tool, and
cleans up. Copy the example out of `node_modules` before running it:

```bash
cp node_modules/@aliou/pi-processes/examples/durable.ts ./durable.ts
node --experimental-strip-types durable.ts
```

## Boundaries

```text
extensions/processes/tools/index.ts         [Pi tool, Pi results and rendering]
  → ProcessManager                         src/manager/index.ts

createProcessExtension                     durable/index.ts
  → createProcessTool                      durable/tool.ts
    → api.createTask(ProcessTask)          [conversation-owned, background]
      → ProcessTask.spawn                  durable/process-task.ts
        → commit spawn-attempt checkpoint
        → ProcessManager.start
        → ProcessRuntime.track             durable/runtime.ts
        → commit process ID and log paths
      → ProcessTask.observe
        → ProcessRuntime.observe
        → commit terminal result
        → addressed host notification      durable/notifications.ts
      → ProcessTask.abort
        → ProcessRuntime.stop
          → ProcessManager.kill
        → commit aborted outcome
```

`src/` contains process state, process groups, I/O, logs, and process-level
utilities. It has no Pi or durable imports. Pi's actions, schemas, notifications,
and UI stay under `extensions/`. Durable's tool, schemas, observation, watches,
and notification policy stay under `durable/`. Each integration uses the existing
manager; neither imports the other's implementation.

## Execution and ownership

`createProcessExtension(options)` accepts:

- `manager`: a borrowed `ProcessManager`. Without one, the extension creates and
  owns a manager. `ProcessManager` is also exported from `/durable` for this use.
- `shellPath`: shell configuration for an owned manager. A borrowed manager keeps
  its own shell configuration.
- `cwd`: fallback execution directory. Start's cwd takes precedence, followed by
  the calling execution environment's cwd and the conversation agent's cwd.
- `env`: complete spawn environment. When absent, the manager inherits the host
  environment. No Pi session variables are added. Environment values stay in
  host memory rather than task input.
- `onNotification`: synchronous addressed callback. Queue async host delivery
  and handle its errors outside the callback. Notifications are not an outbox.

The extension exposes `manager` for direct host inspection and `dispose()` for
cleanup. Use one extension instance per Harness; conversation/task IDs share
that Harness's address space. Closing a Harness cancels observation but does not
stop OS processes. Close the Harness, then dispose the extension. Disposal clears
integration-owned listeners, observations, watch state, and delivery timers. It
kills live process groups and removes retained logs only for an owned manager.
The host must clean up a borrowed manager separately. Disposal is idempotent.

## Native tool contract

The tool uses `replay: "unsafe"`. Its schemas and JSON results are local to
durable; it does not expose Pi's `structuredContent` or UI protocol.

| Action | Behavior |
| --- | --- |
| `start` | Returns `{ action, taskId, conversationId }` after creating a background task. It does not wait for spawn or exit. |
| `list` | Returns process snapshots with associated task IDs, status filters, sorting, and a bounded result count. |
| `output` | Selects stdout/stderr tails and optional literal/regex matches. Reports full log paths as native diagnostics. |
| `write` | Writes stdin or closes it with `end`; reports success and byte count. |
| `update` | Renames a process or appends, replaces, removes, or clears log watches. |
| `stop` | Waits for termination attempts for one ID or all live processes; returns per-process results. |
| `clear` | Removes finished manager entries and their logs. |

The Harness owns text truncation through the tool's `outputLimits`: 50 KiB,
2,000 lines, retaining the tail. Structured output details keep at most 20 KiB of
JSON line data per stream. List and stop arrays use a 64 KiB JSON budget; omitted
items set `truncated`. List defaults to 20 records with a maximum of 100. Names,
commands, cwd, and errors in snapshots are previews; full process descriptions
remain in manager records and task input/outcomes. Output scans at most 5,000
lines per stream when filtering, and returns at most 2,000 lines per stream.

Log watches support literal/regex patterns, stream selection, one-shot or repeated
matches, and attention. There are at most 20 watches per process, with patterns
limited to 500 characters. Repeated watches have a 15-second cooldown. Appending
or removing watches keeps the fired/cooldown state of retained watches; replacing
or clearing resets it.

## Tasks and recovery

Task input records the initiating conversation, runtime identity, name, command,
cwd, and initial notification policy. Observe checkpoints record the process ID
and stdout/stderr log paths. Outcomes record the terminal process snapshot or a
lost-state reason.

- A reopened Harness with the same live extension can resume observation and
  recover a process whose ID checkpoint did not commit.
- A different runtime or missing manager record completes with `status: "lost"`
  and `reason: "manager_state_lost"`.
- A spawn-attempt checkpoint with no known process completes with
  `reason: "spawn_outcome_unknown"`. It never spawns again. A crash before the OS
  effect can lose the requested command rather than execute it twice.
- Interrupted unsafe tools do not rerun starts or stdin writes.
- Aborting a background task stops its tracked process before committing an
  aborted outcome. If stop fails, the abort handler throws instead of claiming a
  confirmed stop. If tracking is already lost, cancellation cannot confirm that
  the OS command stopped.

App restart does not restore OS handles, processes, watches, or manager records.
A detached command may survive a host crash; a lost outcome does not prove it
stopped. Inspect external state before starting another command. Do not kill a
persisted PID without confirming its identity. There is no daemon or process
restart persistence.

## Host notification routing

Every notification carries `conversationId`, `taskId`, and `processId`. A
suppression summary aggregates watches in one conversation and has null task and
process IDs. Tracking-loss notifications have the initiating task address and a
`lost` outcome.

The extension sends nothing to main or a focused conversation. The host chooses
whether `turn` submits input and how `context` or emitted `ignore` notes are
stored. Success defaults to `turn`, failure to `turn`, and external kill to
`context`. Ignored successes and external kills are suppressed; failures promote
`ignore` to `context`. Intentional stops always use `context`.

Watch delivery is capped at 20 matches per minute per initiating conversation.
A context summary reports suppressed matches. Terminal task receipts are
canonical; the host callback is best-effort and is not replayed after recovery.

## Verification

From the repository root:

```bash
pnpm test
pnpm test:e2e
pnpm test:durable
pnpm lint
pnpm typecheck
pnpm build
pnpm check:package
```

Native tests use faux models, repository process fixtures, temporary directories,
and storage reopen rather than fixed sleeps. `check:package` verifies the actual
tarball with isolated Pi resource discovery, a native durable import without the
coding-agent or TUI hosts, a TypeScript consumer, and the shipped example.
