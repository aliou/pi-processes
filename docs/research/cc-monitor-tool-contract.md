# Claude Code Monitor Tool — Contract Reference

Source-grounded reference for Claude Code's **Monitor tool** (background
streaming events), kept here to ground the notification/stall work in
[`../plans/competitor-parity-roadmap.md`](../plans/competitor-parity-roadmap.md).
Dated **2026-06-02**.

## Sources

- **Tool description** (the shipped prompt): Piebald `claude-code-system-prompts`
  → `system-prompts/tool-description-background-monitor-streaming-events.md`,
  `ccVersion: 2.1.119` (repo tracks v2.1.159).
- **Integration surface**: decompiled CC source mirror at **v2.1.88** — the
  Monitor impl modules are dead-code-eliminated from the published bundle, but
  the surrounding task/notification machinery reveals the contract.
- **Behavior/availability confirmation**: Anthropic tools-reference,
  AgentPatterns, claude-code-from-source Ch10, GH issue anthropics/claude-code#45928.

> Correction to earlier notes: the Monitor tool is **real and shipped** (behind
> a feature flag, enabled on recent Opus models), not "leaked-only vaporware".
> It only looks absent in decompiled mirrors because its modules are stripped
> and the description lives in compiled JS.

---

## What it is

> Start a background monitor that streams events from a long-running script.
> Each stdout line is an event — you keep working and notifications arrive in
> the chat.

Streaming-only. **stdout is the event stream; each line → one notification.**
Exit ends the watch. Events are not user replies even if one lands mid-question.

### Parameters
| Param | Meaning |
|-------|---------|
| `command` | shell script; runs in the same shell env as Bash |
| `description` | shown in **every** notification ("errors in deploy.log") |
| `timeout_ms` | auto-terminate; default **300000** (5 min); timeout → killed |
| `persistent: true` | session-length watch; runs until `TaskStop` or session end |

(Param names confirmed via description + web; the compiled input schema is not
on disk.)

### Behavior
- **200ms batching** — stdout lines within 200ms fold into one notification.
- **Stderr ≠ events** — stderr goes to the output file (readable via `Read`),
  never notifies. Merge `2>&1` to route failures into the filter.
- **Auto-stop on flood** — "monitors that produce too many events are
  automatically stopped; restart with a tighter filter." (Threshold value
  unpublished.)
- **`TaskStop`** cancels early; exit code reported on termination.

### Usage taxonomy (decision framework)
- **One** notification ("tell me when ready/done") → **Bash `run_in_background`**
  with a command that exits when true (`until grep -q "Ready in" dev.log; do
  sleep 0.5; done`). NOT Monitor.
- **One per occurrence, indefinitely** ("every ERROR line") → Monitor + unbounded
  command (`tail -f`, `inotifywait -m`, `while true`).
- **One per occurrence, until a known end** → Monitor + command that emits then
  exits.

### Script-quality rules (prompt-enforced)
- Always `grep --line-buffered` in pipes (block buffering delays events minutes).
- Poll loops tolerate transient failures (`curl ... || true`); 30s+ remote,
  0.5-1s local.
- **"Silence is not success"** — the filter must match every terminal state, not
  just the happy path; a success-only grep stays silent through crash/hang/OOM
  and silence reads as "still running". Widen the alternation
  (`elapsed_steps=|Traceback|Error|FAILED|Killed|OOM`) rather than narrow it.
- Don't use an unbounded command for a single notification; `tail -f log |
  grep -m1` does not fix it (pipeline hangs to timeout if the log goes quiet).

---

## How it wires in (v2.1.88 integration surface)

Impl files (`tools/MonitorTool/`, `tasks/MonitorMcpTask/`,
`MonitorMcpDetailDialog`, `MonitorPermissionRequest`) are `require`d behind
`feature('MONITOR_TOOL')` but absent on disk. Surrounding machinery:

- **Registration** — tool in `tools.ts`; task type `MonitorMcpTask` in
  `tasks.ts` `getAllTasks()`; permission case in `PermissionRequest.tsx`.
- **Streaming completion** (`LocalShellTask`, `kind === 'monitor'`) — distinct
  summaries (`Monitor "X" stream ended / script failed / stopped`),
  deliberately NOT the bash prefix, so they don't fold into the "N background
  commands completed" collapse. Comment: *"streaming-only (post-#22764) — the
  script exiting means the stream ended, not 'condition met'."*
- **task-notification XML** (terminal completions):
  ```
  <task-notification>
    <task-id>…</task-id>
    <tool-use-id>…</tool-use-id>   (optional)
    <output-file>…</output-file>
    <status>completed|failed|killed</status>
    <summary>…</summary>
  </task-notification>
  ```
  Output path lets the model `Read` directly — `TaskOutputTool` deprecated.
  Stream-event pings (`enqueueStreamEvent`) carry **no `<status>`** so they're
  not mistaken for terminal completion; SDK emits a `task_notification` event
  only when `<status>` is present.
- **Priority queue** (`messageQueueManager`) — dequeue `now > next > later`,
  FIFO within. User input defaults `next`; task-notifications default `later`
  (user never starved). When `MONITOR_TOOL` on, monitor completions bump to
  `next` and drain mid-turn without a Sleep flush.
- **Sleep-block enforcement** — when `MONITOR_TOOL` on + not background,
  `detectBlockedSleepPattern` rejects `sleep N` (N≥2) as the first statement
  (`errorCode 10`), steering to `run_in_background` (one-shot) or Monitor
  (streaming). Sub-2s allowed. Over-budget blocking commands auto-background
  after `ASSISTANT_BLOCKING_BUDGET_MS = 15000`.
- **Lifecycle** — `killMonitorMcpTasksForAgent(agentId)` on agent end;
  `abortSpeculation` on task-state change.

### Two "monitor" concepts
- **Monitor tool** (user-facing streaming events) — runs a script as a
  `LocalShellTask` of `kind: 'monitor'`; this is the documented contract above.
- **`MonitorMcpTask`** (registered `monitor_mcp` task type) — the MCP-backed
  transport that hosts it; per claude-code-from-source Ch10 it "watches MCP
  server health". The streaming contract is the part to model; the MCP transport
  is why it needs a managed backend.

---

## Availability / gating

- Behind `feature('MONITOR_TOOL')`; enabled on recent Opus models (v2.1.157
  pushed tool-trigger guidance into the description to improve should-call on
  Opus 4.8).
- **Not available** on Amazon Bedrock, Google Vertex AI, Microsoft Foundry, or
  with `DISABLE_TELEMETRY` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set
  (needs the managed/MCP backend).
- Background tasks generally gate on `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`.

---

## Implications for pi-processes

Maps onto [`../plans/competitor-parity-roadmap.md`](../plans/competitor-parity-roadmap.md):

- **Phase 1 / #2 deliverAs split** — pi-processes' `watch_matched` ≈ stream
  event (deliver `steer`, no terminal status); `lifecycle` ≈ task-notification
  (deliver `followUp`, carries status). Mirror CC's "user input never starved"
  when bumping output wakes.
- **Phase 1 / #3 wake budget** — CC's **auto-stop on too many events** is the
  canonical precedent; cap/budget `logWatches` and emit one "stopped, tighten
  filter" notice.
- **Phase 2 / #8 stall watchdog** — CC enforces "silence is not success" via
  prompt guidance + `timeout_ms`→killed. pi-processes can add a real
  silence-timer + prompt-pattern detector, and should also carry the prompt-level
  "match every terminal state" instruction.
- **Notification shape** — adopt the `<task-notification>` fields (task-id,
  output-file, status, summary) with output-file as the `Read` escape hatch.
- **Don't replicate** the MCP/managed-backend coupling — pi-processes is
  local-process-only; model the streaming contract, not the `MonitorMcpTask`
  transport.

## Open / unverified
- Exact compiled input schema (zod/typebox) — not on disk.
- Auto-stop threshold (event count / rate) — documented as behavior, value
  unpublished.
- v2.1.159 vs 2.1.119 Monitor description — last change was the "decision
  framework" addition; later patch versions are no-op diffs.
