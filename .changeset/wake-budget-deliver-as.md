---
"@aliou/pi-processes": minor
---

Refine background-process notification semantics:

- **Delivery split**: output-pattern watch wakes are now delivered as `steer`
  (mid-turn, so the agent reacts while still working) and lifecycle completions
  as `followUp` (delivered only once the agent has no more tool calls, so a
  finishing process no longer interrupts an in-progress tool sequence).
- **Per-watch wake budget**: a noisy watch now stops waking after a budget
  (default 20 per watch; configurable via `watch.maxWakesPerWatch` or per-watch
  `maxWakes`, with `0` = unlimited), emitting a single budget-reached notice.
  The full log stays reachable via the `output`/`logs` actions. This bounds
  context flooding from chatty repeat watches; single-fire watches are
  unaffected.
- **Consecutive-duplicate dedupe**: optional suppression of consecutive
  identical matched lines via `watch.dedupeConsecutive` (config) or per-watch
  `dedupe` (default off).
