# Competitor-Parity Implementation Roadmap

Phased plan to close the real gaps between pi-processes and the leading
competing Pi background-task extensions. Dated **2026-06-02**.

Inputs:
[`../research/competitor-ux-deep-dive.md`](../research/competitor-ux-deep-dive.md)
(pattern backlog) and a source-verified capability baseline of the current
`src/` tree.

## Baseline (source-verified, v0.9.3)

| # | Pattern | Status | Evidence |
|---|---------|--------|----------|
| 1 | Two-layer UX (status line + dock) | **PRESENT** | `hooks/widget/setup.ts:32-166`, `components/log-dock-component.ts` |
| 4 | Bounded tail + full-log path | **PRESENT** | `tools/actions/output.ts:159-263`, `logs.ts:66-92` |
| 5 | Renderer registered by message type | **PRESENT** | `hooks/message-renderer.ts:54-103` (`ad-process:update`, routed by `details.kind`) |
| 9 | Process-group kill SIGTERM→SIGKILL | **PRESENT** | `utils/process-group.ts`, `manager.ts:411-460` |
| 2 | Completion `deliverAs` split | **PARTIAL** | `hooks/process-end.ts:45-67`, `process-watch.ts:44-83` — `safeSendMessage` + `triggerTurn`, no `steer`/`followUp` |
| 3 | Debounced wake + dedupe + budget | **PARTIAL** | `manager.ts:79-118,682-714` — 100ms throttle + 5s repeat cooldown + fired flag, no per-process budget/dedupeKey |
| 7 | Timeout → decision (`keep\|kill\|check`) | **PARTIAL** | `manager.ts:382-460`, `kill.ts:26-73` — `terminate_timeout` + UI SIGKILL, no agent decision surface |
| 6 | Persistence (session entries + PID restore) | **ABSENT** | in-memory `Map` only (`manager.ts:53-65`); no `appendEntry`/`getBranch` |
| 8 | Stall watchdog (stuck-output detection) | **ABSENT** | watches are regex-only (`process-watch.ts:41-83`) |
| 10 | Notification provider registry | **ABSENT** | single renderer + TUI only (`config.ts:29-99`) |

Current `process` tool actions: `start, list, output, logs, kill, clear, write,
debug_preview` (`tools/actions/index.ts:45-82`). `start` params: `name, command,
cwd, alertOnSuccess, alertOnFailure, alertOnKill, logWatches[{pattern, stream?,
repeat?}]` (`tools/actions/start.ts:12-27`).

Notification path today: both `process_end` and `process_watch` send one
`customType: "ad-process:update"` message with `details.kind` =
`lifecycle | watch_matched`, `display:true`, `triggerTurn` (cooldown-gated on
watch). One renderer branches on `kind`.

---

## Phase 1 — Notification semantics (PARTIAL #2 + #3)

**Why first:** highest value, lowest risk, no new persisted state. Reuses the
existing `safeSendMessage` + `customType` + renderer-by-kind path; only enriches
delivery + throttle.

**Scope**
- `#2 deliverAs split`: thread a `deliverAs` through `safeSendMessage` calls.
  - `process_watch` output wake → `deliverAs: "steer"` (keep the turn going)
    — `hooks/process-watch.ts:44-83`.
  - `process_end` lifecycle wake → `deliverAs: "followUp"` (new completion)
    — `hooks/process-end.ts:45-67`.
  - Verify `safeSendMessage` (`hooks/utils.ts`) forwards the option to the
    underlying `pi.sendMessage`/`sendUserMessage`.
- `#3 wake budget + dedupe`: extend the watch throttle.
  - Add per-process wake budget (max wake count and/or max emitted chars) +
    optional `dedupeKey` on `LogWatch`; suppress further output wakes after the
    budget, emitting a single "budget exhausted; inspect log" notice (mirror
    `@vanillagreen` `constants.ts:24-45`, `wake-events.ts:552-599`).
  - Touch points: `constants/types.ts` (`LogWatch`), `manager.ts:79-118,592-714`
    (watch resolution + firing), `tools/actions/start.ts:12-27` (schema +
    validation), `config.ts` (default budget knobs).

**Acceptance**
- Output-pattern wake arrives as `steer`; completion wake as `followUp` (verify
  in a live session via the rendered message + turn behavior).
- Repeated noisy matches stop after the configured budget with one notice; full
  log still reachable via `output`/`logs`.
- `typecheck` + `lint` clean; unit coverage for budget/dedupe in
  `manager.test.ts`.

**Risk:** low. Behavior-additive; defaults preserve current behavior.

---

## Phase 2 — Stall watchdog (ABSENT #8)

**Why second:** closes the named CC-parity gap (~45s watchdog,
`competitive-landscape.md` §2); builds on Phase 1 delivery semantics.

**Scope**
- New detector in the watch loop: per-process silence timer (no new output for
  N seconds, configurable, CC ≈ 45s) and/or prompt-like-output match
  (`y/n`, `Press Enter`, `Password:`). Reference pi-tau
  `features/background.ts:57-131`.
- Emit a distinct wake: new `details.kind: "stalled"` on `ad-process:update`,
  delivered as `steer`, with actionable guidance (attach / write stdin / kill).
- Touch points: `manager.ts:157-181,682-714` (watch loop + timers),
  `hooks/process-watch.ts`, `hooks/message-renderer.ts:54-103` (new `kind`
  branch), `config.ts` (`stall.silenceSeconds`, `stall.promptPatterns`,
  enable flag), `constants/types.ts`.

**Acceptance**
- A process that goes silent past the threshold, or prints a known prompt,
  produces exactly one `stalled` wake (subject to Phase 1 budget).
- Renderer shows a clear stalled card; disabled by default config flag flips it
  off cleanly.
- Tests for silence-timer + prompt-pattern detection.

**Risk:** medium. Timer lifecycle must not leak across kill/clear/reload.

**Depends on:** Phase 1 (delivery + budget).

---

## Phase 3 — Timeout → decision workflow (PARTIAL #7)

**Why third:** upgrades the existing `terminate_timeout` into an agent-facing
`keep | kill | check` decision (pi-tau `job_decide`,
`features/background.ts:914-997`), reducing interruption friction on long jobs.

**Scope**
- On timeout, instead of (or before) auto-terminate, surface a decision wake
  (`details.kind: "decision"`, `followUp`) naming the process and elapsed time.
- Add a `decide` tool action (`keep` extends/clears timeout, `kill` terminates,
  `check` returns a bounded tail) — `tools/actions/` + `tools/actions/index.ts`.
- Track `pendingDecisionProcessId` in the manager (mirror pi-tau
  `state.ts:13-29`).
- Touch points: `manager.ts:382-460`, `tools/actions/index.ts:45-82`, new
  `tools/actions/decide.ts`, `hooks/message-renderer.ts`, `config.ts`
  (timeout-to-decision toggle + grace).

**Acceptance**
- A timed-out process emits one decision wake; each of `keep|kill|check`
  produces the correct effect; default config can preserve current
  auto-terminate behavior.
- Tests for the three branches + pending-decision state cleanup on
  kill/clear.

**Risk:** medium. New tool-action surface; must not strand processes in
"pending decision" forever (fallback to auto-terminate on grace expiry).

**Depends on:** Phase 1.

---

## Phase 4 — Persistence + restore (ABSENT #6)

**Why fourth:** foundational but highest blast radius and fully independent of
Phases 1-3, so it lands after the cheaper wins. Enables surviving
reload/fork/compaction.

**Scope**
- Snapshot the process registry to session entries via `pi.appendEntry` as
  `custom` entries (metadata only, never sent to model) — pattern from pi-tau
  `index.ts:268-304,523-541` and pi-subdir-context v3 (snapshot +
  subtraction-on-compaction).
- On `session_start` / `session_tree`, rebuild `manager.processes` from the
  latest snapshot and **verify PID liveness** (drop dead PIDs, re-attach live
  ones; reconnect log files).
- Decide reattach semantics for log streaming on restored live PIDs (may only
  recover the on-disk log, not the live stream — document the limit).
- Touch points: `manager.ts:53-230,311-319`, `hooks/widget/setup.ts:145-164`
  (extend `session_start`/`session_shutdown`), new
  `hooks/persistence.ts` + `utils` for snapshot/restore, `constants/types.ts`.

**Acceptance**
- Start a process, reload the session → process reappears in `list`/dock with
  correct status; dead PIDs are pruned; no duplicate entries across
  reload/fork/compaction.
- Snapshot entries are metadata-only (never injected into model context).
- Tests for rebuild + PID-liveness + dedupe.

**Risk:** high. State duplication across reload/fork/compaction is the classic
failure (see pi-subdir-context v3 history); design subtraction-on-compaction up
front. PID-reattach is OS-sensitive — verify on macOS first.

**Depends on:** none (independent track; can run parallel to 1-3 in a worktree).

---

## Phase 5 — Notification provider registry (ABSENT #10)

**Why last:** purely additive out-of-TUI alerting; lowest urgency, most
optional. Cleanly layered on Phase 1's notification path.

**Scope**
- Provider registry abstraction (pi-tau `notifications/registry.ts:12-70`):
  built-in `terminal` (OSC 777 / Kitty OSC 99 / WT toast) + optional `pushover`.
- Hook providers into the existing lifecycle/decision/stall wakes so a finished
  or stalled process can fire a desktop/phone alert, gated by config + DND.
- Touch points: new `src/notifications/` (registry + providers),
  `config.ts` (enabled providers + per-provider config via
  `@aliou/pi-utils-settings`), wire from `hooks/process-end.ts` /
  stall / decision emitters.

**Acceptance**
- With the terminal provider enabled, a completion fires an OSC notification;
  disabled by default; pushover behind explicit config.
- No provider failure breaks the in-TUI notification path.
- Tests for registry dispatch + provider isolation (one failing provider does
  not block others).

**Risk:** low-medium. Keep provider I/O failures non-fatal and off by default.

**Depends on:** Phase 1.

---

## Sequencing summary

```
Phase 1 (notif semantics) ── Phase 2 (stall watchdog)
                          ├─ Phase 3 (timeout decision)
                          └─ Phase 5 (provider registry)
Phase 4 (persistence) ───── independent track
```

- Land 1 → 2 → 3 in order (shared notification path).
- Phase 4 can proceed in parallel (separate files, separate worktree).
- Phase 5 any time after Phase 1.

## Cross-cutting

- Every phase: keep defaults behavior-preserving; gate new behavior behind
  `config.ts` flags resolved through `@aliou/pi-utils-settings`.
- `process` tool + `/ps:*` remain **LLM-only** (per `AGENTS.md`); user surface
  stays monitor/kill.
- Each phase ships with `typecheck` + `lint` clean, unit tests, and a Changeset.
- Upstream risk: `aliou:main` has an open 168-file rewrite (`feat/rewrite`,
  PR #38). Before investing in a phase, decide whether VSH tracks upstream or
  diverges (see `../research/competitive-landscape.md` §1); a large rewrite
  landing upstream would reshape these touch points.
