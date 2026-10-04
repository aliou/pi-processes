# Same-process manager reload probes

These probes replace a manager inside the same Node process. They do not start
a supervisor, socket server, relay, or replacement controller process.
Production `src/` and extension handlers are unchanged.

```sh
node --expose-gc scripts/reload-probe/run.mjs
node --expose-gc scripts/reload-probe/run.mjs --only=fifo-path --keep
node --expose-gc scripts/reload-probe/run.mjs --only=fifo-fd-quit --keep
```

`--expose-gc` enables an assertion that the detached manager is collected.
Without it, the probe logs that collection was not checked. `--keep` preserves
snapshots and logs after stopping all workloads. The printed artifact directory
contains a directory per probe. `--only=<name>` isolates a case.

## Boundary under test

```text
run.mjs start
  loadManager() → fresh module                   bootstrap.mjs
  new ProbeManager()                            manager.ts
  start → fixture copied from tests/e2e/scripts

detach
  remove old child/stream callbacks
  destroy old JS streams
  write minimal state.json
  drop manager reference
  assert collection when GC is available

restore, same host PID
  loadManager() → fresh module
  new ProbeManager(JSON.parse(state.json))
  inspect logs and OS group liveness
  no ChildProcess or stream object from the old manager is used
```

`ProbeManager` is an experimental manager, not the production `ProcessManager`.
The production manager has no public detach/restore API. `baseline` uses its
existing `spawnCommand` primitive. File/FIFO probes launch fixtures directly;
the fixture itself is the process-group leader, with no wrapper. A short-lived
`mkfifo` utility creates FIFOs and exits before the workload starts.

Node may retain internal child bookkeeping while it reaps children. The probes
do not access it after restore. All application callbacks are removed. A
collected old manager and `attachedChildObject: false` check that no manager or
child reference is handed to the replacement. This does not load Pi or test
Pi's module loader.

## What each probe observes

| Name | Fixture | Observation under test |
| --- | --- | --- |
| `baseline` | `wait-for-file.sh` | Closed anonymous output pipes cannot be reconnected from PID/path metadata. |
| `continuous` | `continuous-output.sh` | Direct file output continues with no manager and can be read after restore. |
| `mixed-output` | `combo-output.sh` | New stdout and stderr lines continue with no manager. |
| `watcher` | `stateful-test-watcher.mjs` | Work progresses across three module/manager replacements. |
| `clean-exit` | `wait-for-file.sh` | Death and output are observable; exit code 0 is not recoverable after removing the close callback. |
| `failure` | `crash-on-file.sh` | Fatal stderr and death are observable; exit code 42 is not recoverable. |
| `group-sigkill` | `continuous-output.sh` | Death before restore is detected; original signal is not recovered. |
| `fifo-path` | `stdin-echo.sh` | Closing all parent FIFO handles gives the command EOF; a saved pathname cannot revive that reader. |
| `fifo-fd-quit` | `stdin-echo.sh` | Serialized integer FD supports writes across two replacements, followed by quit. |
| `fifo-fd-eof` | `stdin-echo.sh` | Same FD supports restored writes; explicitly closing it delivers EOF. |
| `closed-fd` | `stdin-echo.sh` | Restoration rejects an already-closed FD. |

Checks passing include expected limitations. They do not claim that full process
restoration works. Logs show commands, PIDs, process trees, JSON snapshots, raw
output, and explicit unknown exit outcomes.

## File paths versus kernel descriptors

The strict file-path cases save no live stdin handle. The `fifo-fd-*` cases
deliberately keep one FIFO descriptor open in the host OS process and save
only `{ fd, dev, ino }`. No live JS object survives, but a live kernel resource
does. This is not a solution if the constraint also forbids retained OS handles.

The descriptor is valid only in the same host PID. Restoration verifies that
it still refers to the expected FIFO. Command stdin gets a read-only descriptor;
giving the command a read/write descriptor would prevent EOF. No supervisor or
stdin relay is used.

## Boundaries

- Exit codes/signals from completion during detachment are unknown. They are
  not fabricated from the stimulus or recovered through an old callback.
- No anonymous pipe is reconstructed through private Node handle fields.
- No buffers, status, signals, output queues, or completion state are serialized.
- Stdin writes are small and synchronous; backpressure/timeouts, concurrent
  writers, and arbitrary workloads are not covered.
- FIFO behavior and descriptor lifetime are checked on the host platform,
  not through a portability simulation. See the verified-host matrix below.
- Group liveness is not secure PID-reuse identity validation.
- Output files are uncapped and separate; combined-log ordering and notification
  watch replay are not tested.
- No full application restart or controller crash recovery is claimed. Failed
  reload and quit cleanup policies are not implemented by these probes.
- The harness retains only plain workload metadata for assertions and cleanup.
  It kills every probe group and closes remaining owned FDs before removing files.

`bootstrap.mjs` uses the existing pnpm-installed `jiti` for fresh TypeScript
module loads. No dependency or production API is added.

## Whole-process descriptor lifetime

This separate probe tests actual owner-process death, not module reload:

```sh
node scripts/reload-probe/fd-lifetime.mjs --keep
```

It requires `lsof` in PATH. On macOS, the system supplies it. Linux needs it
installed before running this probe; missing `lsof` is an error, not a pass.

```text
fd-lifetime.mjs observer
  spawn fd-owner.mjs test subject (models the whole Pi process)
    ProbeManager starts fixture with FIFO stdin and file output
    print owner PID, numeric FD, FIFO device/inode/path, workload PID
    leave raw FIFO descriptor open; no exit cleanup handler
  lsof → verify owner's open FIFO FD and command's read-only stdin
  let subject process.exit(0), or SIGKILL subject only
  wait for owner process exit
  lsof → check owner's (PID, FD) entry is gone
  check whether workload exited on EOF or survived
  only then clean remaining workload groups
```

The observer is test instrumentation, not a supervisor or FIFO relay. It never
opens or writes the FIFO. The scenarios cover normal exit, SIGKILL followed by
stdin EOF, and a workload that survives owner SIGKILL because it ignores stdin.

FD numbers are local to one process. `(owner PID, FD)` identifies the open
handle for this observation. `(device, inode)` identifies the FIFO filesystem
object while it exists. The FIFO path can remain after every handle is closed;
its presence alone does not prove an open descriptor remains.

The queries use `lsof -w` to suppress unrelated mount-scan warnings on Linux
hosts running containers. Each case requires a positive owner-FD match before
exit, waits for owner reaping, and independently checks that its PID is gone.

`--keep` retains `owner.json` and output files after cleanup. The printed
`lsof -nP -a -p <owner PID> -d <FD>` commands can be repeated after the driver
exits. No output (exit code 1) means no matching open descriptor. Do not look
up that FD in the observer or a new Node process: the same number can refer
to a completely different resource there.

## FIFO-backed output and capped logs

```sh
node --expose-gc scripts/reload-probe/fifo-stdio.mjs
```

This separate probe uses FIFOs for all three streams. The host keeps only the
raw descriptor integers/device/inode across manager replacement. Command
stdout/stderr are blocking FIFO write ends. The manager reads nonblocking FIFO
ends and writes disk logs through the production `ProcessLogStore`.

`tests/e2e/scripts/burst-output.sh` emits a marker-driven 256 KiB burst per
stream. During detachment, no application code drains output or appends logs.
Bytes stay in bounded kernel queues; a writer blocks when its queue fills.
After restoration, the fresh manager drains the queues. The probe uses a small
4 KiB per-file cap, checks it on every capture, and verifies truncation markers
and final stdout/stderr markers. It does not test combined-stream ordering or
exact exit-code recovery. Disk logs remain available after command completion.

The same script also releases success and failure fixtures while no manager
exists, waits for their groups to die, and then restores capture. It requires
their queued stdout/stderr to reach the log files even though the commands have
already exited. Actual exit codes remain unknown.

The production log helper has a hardcoded "64 MB" truncation message. This
probe overrides its cap to 4 KiB but does not change that message. Cap assertions
use actual file sizes, not the message. Making that label reflect a configured
cap is a separate production fix.

## Verified hosts

The 11 same-process probes, three owner-exit cases, and FIFO output burst ran
on these actual hosts, without a supervisor or socket:

| Host | OS / architecture | Node |
| --- | --- | --- |
| Local Mac | Darwin arm64 | 24.21.0 |
| `smoke-kai-controls-8da150` sandbox | Linux x86_64 | 26.7.0 |
| Joey | Linux aarch64 | 24.19.0 |

Linux probes use available Bash paths, not an assumed `/bin/bash`. The tested
FIFO read/write behavior is a platform-specific observation on these hosts,
not a promise that every POSIX implementation supports it identically.
