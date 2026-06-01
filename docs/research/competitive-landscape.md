# pi-processes — Competitive Landscape & Claude Code Reference

Research snapshot. Dated **2026-05-31**. Re-check live npm download counts and
upstream branches before acting on anything time-sensitive here.

Grounds future work on the VSH fork (`victor-software-house/pi-processes`,
fork of `aliou/pi-processes`).

---

## 1. Fork status

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

## 2. Relation to Claude Code's Monitor / background tooling

Grounded in CC source audits (`collection-claude-code-source-code`,
`Piebald-AI/claude-code-system-prompts`, memory sessions on CC arch).

CC native process architecture:

- **BashTool** with `run_in_background` parameter.
- **MonitorTool** (stream-only) — feature-gated, **stripped/dead-code-eliminated
  from published npm bundle**; only present in leaked source.
- **TaskOutputTool** (deprecated), **TaskStopTool**, **AgentTool**.

pi-processes ≈ BashTool backgrounding + MonitorTool collapsed into one `process`
tool.

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

## 3. Competing Pi background-process packages

Ranked by npm weekly downloads (snapshot 2026-05-31).

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

## 4. Open questions / next steps

- Decide goal: rebrand+publish under `@victor-software-house` (VSH baseline:
  pnpm 11.2.2, GitHub Packages, CI tokens) vs. feature/fix work on the fork vs.
  research only.
- If adopting CC patterns: priority queue + stall watchdog are the highest-value
  gaps vs. CC.
- Deep-source-scan candidates for portable UX/widget patterns: pi-tau,
  pi-background-tasks, @vanillagreen/pi-background-tasks.
