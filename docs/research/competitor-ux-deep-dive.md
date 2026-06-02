# Competitor UX/Source Deep-Dive

Source-level scan of the three highest-signal competing Pi background-task
extensions, focused on UX/layout/widget patterns and notification mechanics
worth porting into pi-processes. Dated **2026-06-02**.

Tarballs were unpacked and read directly (npm `pack`). Companion file:
[`competitive-landscape.md`](./competitive-landscape.md).

Packages scanned:

- **pi-tau** 1.6.0 — QoL bundle (bg tasks + notifications + pill-bar)
- **pi-background-tasks** 0.6.0 — CC-faithful named bg shell manager
- **@vanillagreen/pi-background-tasks** 1.6.0 — explicit non-blocking tasks + completion wake

---

## 1. pi-tau 1.6.0

- Entry `./index.ts`; tools `bash`, `bash_bg`, `jobs`, `job_decide`, `task`,
  `agent_bg`, web/chrome tools. Commands `/bg /fg /jobs /tasks /footer
  /notifications …`. Keys `Ctrl+B Ctrl+J Shift+Down Ctrl+X …`.

**Status / pill-bar UX**
- Dual surface: `ctx.ui.setWidget("background-jobs", pills)` + `ctx.ui.setStatus("background-jobs", …)`; cleared when no running jobs (`src/features/background.ts:142-175`).
- Pills = per-job `icon id command(25) (duration)`; `◐` backgrounded vs `▶` running.
- Agent-turn status `ctx.ui.setStatus("tau-turn", spinner + elapsed)` on a **1s** interval (`src/features/titlebar.ts:69-131`).
- Custom footer via `ctx.ui.setFooter(fn)` subscribing to branch changes, left/right aligned metrics (`src/features/custom-footer.ts:12-77`).

**Task model**
- `bash` auto-backgrounds after timeout (blocks sleeps ≥2s); `bash_bg` immediate; `jobs: list|output|kill|attach`; `job_decide: keep|kill|check` for timed-out jobs (`src/features/background.ts:362-997`).
- State in `TauState.backgroundJobs / runningProcesses / jobCounter / pendingDecisionJobId`.

**Persistence**
- Saves `background-tasks-state` session entry on shutdown; restores + verifies PID liveness on start (`src/index.ts:268-304, 523-541`).

**Notifications**
- `agent_end` → `shouldNotify()` → `sendNotification()`; pluggable **provider registry** (terminal + pushover), terminal uses WT toast / Kitty OSC 99 / OSC 777 (`src/notifications/registry.ts:12-70`, `terminal.ts:26-54`).
- Pushover emergency mode = priority 2 + retry/expire.

**Stall watchdog** — detects prompt-like stuck output, escalates with actionable guidance (`src/features/background.ts:57-131`).

---

## 2. pi-background-tasks 0.6.0

- Entry `src/extension.ts`; tools `bg_run/bg_status/bg_logs/bg_kill`; commands `/bg /tasks /jobs /logs /kill /bg-clear /bg-update`; `Shift+Down` opens dock.

**bg_run schema** (`src/extension.ts:62-70`)
```
name (req, 2–6 words), command, isAgent (req),
description?, timeoutSeconds?, notifyOnCompletion?, triggerOnCompletion?
```
- Defaults `notifyOnCompletion=true`, `triggerOnCompletion=true`. CC-style compact `renderCall`/`renderResult`.

**Status/list UX**
- Footer synthesized every 1s + on change: `bg N running · M failed · Shift↓ · /bg-clear · ⬆ vX` light-blue block (`src/extension.ts:134-160`).
- Dock = bottom-center overlay 96% × 60% (`:181-227`).
- List: 14 rows, sort running→failed→killed→completed, color status, unread dot, runtime, bytes, context%, model, tokens, tools, live activity (`src/ui/background-tasks-manager.ts:532-612`).
- Detail view + boxed output tail; live tail 12 lines @1s; scroll-up freezes follow, `r` resumes (`:614-682`).

**Notifications** — `pi.sendMessage(type="background-task-notification", { deliverAs: "followUp", triggerTurn })`; XML-ish payload `<task-id> <task-name> <status> <exit-code?> <error?> <output-file> <summary>` (`src/core/registry.ts:1011-1040`). Renderer → `[bg status] name (id)` colorized.

**Kill / caps**
- Hard timeout SIGTERM → SIGKILL grace (`registry.ts:944-993`).
- Output cap: 50 KiB model-facing / 20 MiB persisted; overflow truncates + kills (`common.ts:396-399`).
- **Agent telemetry wrapping**: only when `isAgent` + command looks like `pi -p`/`--mode json`, parses assistant/tool/context/model events into metadata + transcript (`registry.ts:766-941`).

---

## 3. @vanillagreen/pi-background-tasks 1.6.0

- Entry `extensions/background-tasks.ts`; `appendSystem` → `instructions.md`; `postinstall`/`preuninstall` inject/remove prompt. Tools `bg_status`, `bg_task`; commands `/bg /bg:list /bg:next /bg:clear /bg:run /bg:stop`; keys `alt+shift+h f5 alt+. alt+h`; renderer `vstack-background-tasks:event`.

**Schema** (`registrations.ts:84-173`)
- `bg_task`: `action ∈ {spawn,list,log,stop,clear}` + `command,cwd,id,notifyOnExit,notifyOnOutput,notifyPattern,notifyMode,dedupeKey,timeoutSeconds,title`. Defaults: exit-wake on, output-wake off, timeout 0.

**Completion-watch (the differentiator)**
- `scheduleOutputReaction()` debounces output, computes unseen tail, checks pattern + budget + notify mode → `sendTaskEvent` (`background-tasks.ts:402-480`).
- `sendTaskWake()` serializes wakes; emits compact snapshot + `matchedPattern` + `outputTail`; **`deliverAs` split: output wake = `steer`, exit wake = `followUp`**, both `triggerTurn:true` (`wake-events.ts:454-536`).
- Renderer by message type (`pi.registerMessageRenderer(BG_MESSAGE_TYPE, …)`): collapsed `● Background task output/finished <id> · <title> · ctrl+o to expand`; expanded adds details + recent output + full-log link (`render.ts:251-293`).
- **Wake budget**: `outputAlertMaxChars` 2KB default; output wakes suppressed after per-task byte/count cap + one "budget exhausted; inspect log" notice (`constants.ts:24-45`).

**Log tail** — file log canonical; `tailText()` last N chars w/ `[...truncated]`; dashboard `splitOutputLines()` caps visible lines, shows full-log path when truncated.

**UX** — mini-widget above/below editor (counts + top 3 tasks, hidden-rows hint) + full centered dashboard 96 cols × 75%, two-pane list/detail, keys arrows/tab/`s`/`c`/`f`/`x`.

---

## 4. Convergent patterns → pi-processes backlog

Ranked by cross-package signal + value vs current pi-processes (which already
has a dock widget, `logWatches`, `alertOn*`, global+memory config).

| # | Pattern | Seen in | Why it matters | pi-processes today |
|---|---------|---------|----------------|--------------------|
| 1 | **Two-layer UX: mini status/widget + full dock/dashboard** | all 3 | glance vs deep-inspect; the dominant idiom | has dock; status line thinner |
| 2 | **Completion as conversational event w/ `deliverAs` split** (output=`steer`, exit=`followUp`, `triggerTurn`) | vanilla, pi-bg | clean "keep going" vs "new completion" semantics | uses `triggerTurn`+alerts, no steer/followUp split |
| 3 | **Debounced output wake + dedupe + per-task wake budget** | vanilla | kills alert spam; one wake per meaningful change | logWatches lack budget/dedupe |
| 4 | **Bounded inline tail + explicit full-log path** | all 3 | transcript stays small, recovery explicit | partial |
| 5 | **Message renderer registered by type** (isolate wake UX from tool UX) | vanilla, pi-bg | upgrade display without touching lifecycle | — |
| 6 | **Persistent task state via session entries + PID-liveness restore** | pi-tau | survives reload/resume, no external store | unknown/partial |
| 7 | **Timeout → decision workflow (`keep\|kill\|check`)** | pi-tau | reduces interruption friction on long jobs | — |
| 8 | **Stall watchdog** (prompt-pattern stuck-output detection) | pi-tau | hung-process detection; matches CC 45s watchdog | — |
| 9 | **Process-group kill SIGTERM→SIGKILL escalation** | pi-bg | clean teardown, no orphans | unknown |
| 10 | **Notification provider registry** (terminal + pushover) | pi-tau | "job finished" alerts beyond the TUI | — |

### Highest-value, lowest-risk first
- **#2 + #3 + #5** together = the notification UX leap: typed renderer, steer/followUp split, debounced budgeted wakes. This is the single biggest gap vs both vanilla and CC.
- **#8 stall watchdog** + **#7 decision workflow** close the CC-parity gaps named in `competitive-landscape.md` §2.
- **#6 persistence** is foundational if pi-processes does not already survive reload.

### Notes
- pi-background-tasks' **agent-telemetry wrapping** (`isAgent` + `pi -p` detection → parsed transcript) overlaps pi-subagents territory; likely out of scope for pi-processes.
- pi-tau is a broad QoL bundle, not a focused process manager — borrow its pill-bar + provider-registry, not its scope.
