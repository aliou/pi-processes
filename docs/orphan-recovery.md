# Orphan Recovery

How pi-processes recovers managed process groups that outlive a pi session
killed without the chance to clean up (`SIGKILL`, OOM kill), and what the
recovery cannot do. For the graceful shutdown path see
[events.md](events.md); for keeping processes alive across session reloads
see [future-persistent-manager.md](future-persistent-manager.md).

## The gap this closes

Every managed command runs in a detached process group
(`src/utils/command-executor.ts` → `spawnCommand`, `detached: true`), so
group-wide signals can reach the whole tree, and so the child survives the
manager's own lifetime. On graceful exit, the `session_shutdown` hook
(`extensions/processes/hooks/cleanup.ts`) calls `manager.killAll()` and
`manager.cleanup()`, which SIGKILLs each `-pgid` and deletes the log
directory.

A `SIGKILL` of pi runs no handler: the groups survive, are re-parented to
PID 1, and — manager state being in-memory only — no later session even
knows they exist. Until recovery, such orphans kept running until reboot.

## Design

Recovery is deliberately minimal: a small persisted record per *live* managed
process, plus a reap on session start. It is not a persistent manager.

### Records (`src/manager/orphan-recovery.ts`)

When a process starts (or is adopted) with a real pid, the runtime
controller writes one JSON file to the user's cache directory
(`$XDG_CACHE_HOME`/`~/.cache` under `pi-processes/orphan-records/`), outside
the temporary log directory that graceful cleanup deletes. The file is named
`<hostPid>-<processId>.json` and written atomically (temp file + rename). It
records:

- the child pid — which is also the process-group id (`spawnCommand` spawns
  it as the group leader),
- the child's `/proc/PID/stat` starttime (field 22),
- the kernel boot id (`/proc/sys/kernel/random/boot_id`),
- the owning pi host's pid and starttime,
- the name, command, cwd, log dir, and a timestamp.

The record is removed when the process ends (`ProcessRuntimeController.transition`
to a finished status) and, as a backstop, for every live record at graceful
`cleanup()` — so a clean session leaves nothing behind.

### Reap on session start (`extensions/processes/hooks/orphan-recovery.ts`)

On `session_start` (all reasons), the core extension calls
`manager.reapOrphanedProcesses()` (`src/manager/orphan-recovery.ts` →
`reapOrphanedRecords`), which walks every record and applies, in order:

| Condition | Action |
| --- | --- |
| boot id differs | reboot happened; nothing can be alive — discard record |
| host pid alive **and** host starttime matches | a concurrent pi session owns it — keep record |
| host dead, child starttime matches, group alive | SIGKILL `-pgid`; report as recovered |
| host dead, child pid reused (starttime differs) | never signal — discard record |
| host dead, group leader gone (`/proc` entry missing) | never signal — discard record |
| host dead, group already dead | discard record |

Leftover log directories of dead hosts are removed along with their records
(only `pi-processes-*` mkdtemp directories; explicitly configured log dirs
are left alone). Recovered groups are reported to the user with a
`ctx.ui.notify` warning on the session-start path.

When in doubt the reap never kills: an unverifiable host identity keeps the
record, and an unverifiable child identity discards it without signaling.

## Limitations

- **Delayed recovery only.** A SIGKILLed pi leaves its children running
  until the next pi session starts (any project, any session reason) or the
  machine reboots. There is no daemon watching for orphaned groups.
- **Group-leader identity anchor.** Verification uses the group leader's
  `/proc/PID/stat` starttime. A command whose leader exits while leaving
  other processes in the group (for example a shell that backgrounds work
  and exits) cannot be verified and is discarded without a kill.
- **Daemonized commands escape.** A command that calls `setsid`/daemonizes
  leaves the process group entirely, so even a verified group kill cannot
  reach it — this also defeats the pre-existing graceful `killAll()` path.
- **Linux only.** Records are written only when procfs identity is
  available. On macOS (and Windows, which is unsupported overall) recovery
  stays disabled rather than risk killing a reused PID.
- **Corrupt or foreign records are dropped.** Unparseable files or records
  with an unknown version are removed on sight; a record nobody can verify
  must never authorize a kill.

## Tests

- `src/manager/orphan-recovery.test.ts` — record persistence, store
  round-trip and pruning, and the full reap decision matrix (host
  alive/dead, PID reuse, reboot, leader-gone, already-dead) with injected
  identity and signal fakes.
- `src/utils/proc-identity.test.ts` — `/proc` parsing (comm with spaces and
  parentheses) and boot-id/starttime readers.
- `extensions/processes/hooks/orphan-recovery.test.ts` — session-start
  notification behavior, including sanitization of untrusted record text.
- `tests/e2e/orphan-recovery.e2e.ts` — real detached groups and real
  `/proc` identity checks; the dead host is simulated by repointing the
  record at a verifiably dead pid.
