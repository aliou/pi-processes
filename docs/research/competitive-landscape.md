# pi-processes — Competitive Landscape & Reference Architecture

Research snapshots from **2026-05-31** and **2026-08-01**. Re-check live npm/pi.dev downloads and upstream branches before acting on time-sensitive data.

Grounds future work on the VSH fork (`victor-software-house/pi-processes`, fork of `aliou/pi-processes`). The 2026-08 refresh supersedes old “identical fork” and “missing stall/budget” claims below; the older material remains as chronology.

## Current refresh — 2026-08-01

### Fork status

- Upstream `main`: [`42d5891`](https://github.com/aliou/pi-processes/commit/42d58914e9c22371cb080d55c94661db7f93c267), package `0.9.5`.
- VSH `main` at audit: `63b08bc`, package `0.11.1`.
- Divergence: four upstream-only commits and 31 VSH-only commits from merge base `a4c7087`.
- Both retain static tool prompt metadata and transcript-tail lifecycle messages. Neither mutates `before_agent_start.systemPrompt` from live process state.
- A live installed-package probe kept the same 130,808-byte system-prompt SHA-256 (`fe771a4b1aac91cd59412654f9c2119425717026c2a2ac80809c2d6ac5dec256`) before process start, after start, and after completion.

### Intentional VSH drift

| Concern | Upstream | VSH fork |
|---|---|---|
| Completion delivery | `sendMessage`, implicit routing | Explicit `followUp` with conditional wake |
| Watch delivery | Default steer and cooldown | Explicit steer, per-watch wake budget, dedupe, cooldown |
| Stall detection | Absent | Opt-in silence watchdog with actionable wake |
| Output rendering | Package-native renderer | Shared `pi-render-core` bash-style rendering and short file links |
| Release/install | Public npm | Restricted GitHub Packages and VSH tooling baseline |
| Prefix behavior | Stable | Stable |

The fork has already adopted the highest-value findings from the original 2026 research: steer/follow-up separation, wake budgets/deduplication, typed lifecycle rendering, and an opt-in stall watchdog.

### Current focused package corpus

The 2026-08 audit read [`process`](https://pi.dev/packages?name=process), [`background`](https://pi.dev/packages?name=background), and [`monitor`](https://pi.dev/packages?name=monitor) rankings through Exa and inspected 22 package sources (19 Git clones, three npm tarballs).

Highest-signal current peers included:

| Package | Downloads/month snapshot | Main lesson |
|---|---:|---|
| `@trevonistrevon/pi-loop` | 2,796 | Idle-aware scheduled wakes and notification coordination |
| `@99percentpeople/pi-background-tasks` | 2,405 | Explicit waits, PTY support, durable snapshots |
| `pi-patty-bg-tasks` | 2,167 | Exactly-once completion latch and bounded task notifications |
| `@aliou/pi-processes` | 1,436 | Upstream lifecycle and dock baseline |
| `pi-background-tasks` | 1,429 | Event-driven completion contract and anti-poll guidance |
| `@fractaal/pi-agentic-processes` | 1,232 | Auto-background bash plus sparse signal monitors |
| `pi-bg-run` | 843 | Small immediate background-run surface |
| `@haemmid/pi-processes` | 724 | Text-first descendant optimized for pi-web |
| `pi-process-monitor` | 493 | Coalesced process/SSH/log watching |

No focused process package in the corpus dynamically inserted live process state into the parent system prompt. `@vanillagreen/pi-background-tasks` is the notable static-cost exception: it ships a fixed 3,431-byte `appendSystem` document. That is cache-stable but more expensive than VSH's short static guidelines plus on-demand skill.

### Oh My Pi is the primary behavioral reference

Oh My Pi's background-job framework is the strongest reference observed in actual use:

- [`async/job-manager.ts`](https://github.com/can1357/oh-my-pi/blob/aca68ad3a9a8b14e8604b6012b27999b2192737b/packages/coding-agent/src/async/job-manager.ts) centralizes job lifecycle, per-agent ownership, retention, cancellation, stale suppression, and retrying completion delivery.
- [`sdk.ts`](https://github.com/can1357/oh-my-pi/blob/aca68ad3a9a8b14e8604b6012b27999b2192737b/packages/coding-agent/src/sdk.ts) batches job completions through a yield queue into structured tail messages.
- [`job.ts`](https://github.com/can1357/oh-my-pi/blob/aca68ad3a9a8b14e8604b6012b27999b2192737b/packages/coding-agent/src/tools/job.ts) keeps explicit list/poll/cancel intervention separate from automatic completion delivery.

VSH intentionally remains a focused extension rather than porting OMP's whole runtime. The next transferable improvements are delivery retry/batching, stale acknowledgement when a process was explicitly inspected, and a migration-grade prefix/tool/lifecycle contract suite.

---

## Historical snapshot — 2026-05-31

### 1. Fork status

- Package: `@aliou/pi-processes` v0.9.3 (public npm, MIT).
- Upstream: `github.com/aliou/pi-processes`, default `main` @ `96bbcd3`.
- VSH fork `main` == upstream `main` == local clone — **identical** (0/0).
- No VSH commits made beyond the fork.
- Stack: TypeScript strict, pnpm 10.26.1, Biome, Changesets, husky, vitest.
- Tool/command audience is **LLM-only** (`process` tool + `/ps:*`); users only
  monitor via `/ps:logs` and kill via `/ps:list`.

### Upstream pipeline (open PRs, 2026-05-31)

| PR | Branch → base | Author | Notes |
|----|---------------|--------|-------|
| #51 | `changeset-release/main` → main | github-actions[bot] | release **0.9.4** (the `96bbcd3` cwd fix) |
| #38 | `feat/rewrite` → main | aliou | **full rewrite**: 168 files, +10,440 / −6,875; 26 ahead / 13 behind main (needs main rebased in) |
| #34 | `localize-process-kill-list-copy` | jerryfan | i18n of kill/list copy |
| #33 | `feat/decoupled-tooling` | BadLiveware | process metadata updates |

`feat/rewrite` = process-notifications rewrite, 4-phase plan marked "phase four
complete"; the branch to watch for the next major shape.

---

### 2. Relation to Claude Code's Monitor / background tooling

Grounded in CC source audits (`collection-claude-code-source-code`,
`Piebald-AI/claude-code-system-prompts`, memory sessions on CC arch).

CC native process architecture:

- **BashTool** with `run_in_background` parameter.
- **Monitor tool** (stream-only) — **real and shipped**, behind
  `feature('MONITOR_TOOL')` (enabled on recent Opus models). Modules are
  dead-code-eliminated from decompiled mirrors, but the tool description is
  shipped and the contract is fully documented in
  [`cc-monitor-tool-contract.md`](./cc-monitor-tool-contract.md).
- **TaskOutputTool** (deprecated), **TaskStop**, **AgentTool**.

pi-processes ≈ BashTool backgrounding + Monitor tool collapsed into one
`process` tool. Full Monitor contract:
[`cc-monitor-tool-contract.md`](./cc-monitor-tool-contract.md).

Patterns pi-processes mirrors or could adopt (tracked as VSH-117 in
`pi-ecosystem-plan.md`):

- `enqueuePendingNotification` → `<task-notification>` XML with `<task-id>`,
  `<output-file>`, `<status>` (completed/failed/killed), `<summary>`.
  pi-processes currently uses `safeSendMessage` + `triggerTurn` + `alertOn*`.
- **Priority queue**: user-input = `next`, task-notifications = `later`,
  monitor = `next` (so user input is never starved). pi-processes has **no**
  priority queue.
- **Stall watchdog**: ~45s silence + prompt-pattern detection (`y/n`,
  "Press Enter") auto-notifies. pi-processes **lacks** this.
- Guards: `DISALLOWED_AUTO_BACKGROUND_COMMANDS`, module-load feature check via
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`.

### CC analysis assets already on disk

- Clean source: `github.com/victor-software-house/collection-claude-code-source-code`
- System prompts: `~/workspace/victor/fork-mirror/claude-code-system-prompts`
  (clone of `Piebald-AI/claude-code-system-prompts`)
- XML tag inventory: `docs/research/cc-xml-tags-v2.1.159.md` in pi-subagents
  (27 paired tags, no self-closing).

---

### 3. Competing Pi background-process packages (historical)

Ranked by npm weekly downloads in the 2026-05-31 snapshot. See the current refresh above for the later corpus.

| dl/wk | Package | Version | Niche | UX / layout |
|------:|---------|---------|-------|-------------|
| 2501 | `@trevonistrevon/pi-loop` | 0.3.1 | cron/event re-wake **+ bg monitoring** | scheduling-first, not pure proc mgmt |
| 745  | `pi-background-tasks` | 0.6.0 | **CC-like** named bg shell mgr: `bg_run`, `/bg`, status | closest direct competitor; now outranks aliou |
| 530  | `@aliou/pi-processes` (ours) | 0.9.3 | `process` tool, `/ps:*`, dock widget, logWatches | dock + pin widget |
| 466  | `pi-schedule-prompt` | 0.4.0 | recurring/one-shot scheduler (Pi heartbeat) | scheduler |
| 381  | `pi-tau` (τ) | 1.6.0 | QoL bundle: **bg tasks + notifications + pill-bar status** | best status-bar UX |
| 155  | `@vanillagreen/pi-background-tasks` | 1.6.0 | explicit non-blocking tasks, log tails, completion watch | clean wake flow |
| 78   | `@ifi/pi-background-tasks` | 0.5.1 | reactive bg, `/bg`, `Ctrl+Shift+B`, agent wake | keybinding-driven |
| 43   | `@hshayde/pi-monitor` | 0.4.20 | tmux-aware live status monitor | tmux pane status |
| 14   | `@lukemelnik/pi-monitor` | 0.2.0 | monitor live agents, jump to tmux panes | tmux jump |
| 12   | `@zackify/pi-bg-tasks` | 0.1.3 | bg commands **in tmux** | tmux-backed |
| 5    | `pi-monitor` | 0.1.0 | bg procs in **native floating window** | floating-window UI |
| 3    | `pi-process` | 0.1.0 | OpenClaw-style bg bash + session mgmt | early |

Adjacent (task panels, not bg-shell): `@vanillagreen/pi-task-panel` (113),
`@0xkobold/pi-task` (29, kanban), `@jerryan/pi-task-tree`.

### UX/layout references worth studying

- **pi-tau** — pill-bar status line; most polished ambient UX.
- **pi-monitor** — floating-window live output.
- **pi-background-tasks** — the package actively out-competing aliou; most
  CC-faithful `/bg` model.

---

### 4. Remaining questions after the 2026-08 refresh

- Add an in-process regression requiring byte-identical system prompts across start/list/output/completion/clear.
- Include one bounded matched line in model-visible watch content; today the line is available to the renderer through `details`, while the model-visible message only says the regex matched.
- Evaluate OMP-style completion batching and retry without turning `pi-processes` into a general workflow runtime.
- Keep process names, counts, output, paths, and status out of static prompt metadata.
- Preserve focused ownership: subagent telemetry belongs to subagent tooling, not this process manager.
