---
"@aliou/pi-processes": minor
---

Persist context-level notifications immediately instead of deferring them to the next user prompt

`context` and emitted `ignore` notifications (watch log matches, suppressed-match summaries, `onKilled: "context"`) are now sent with `triggerTurn: false` and no `deliverAs`, so Pi appends them as displayed custom messages right away — immediately when the agent is idle, and after the running turn's tool results otherwise. They still never wake or steer the agent.

Requires the Pi extension host that appends custom messages at the turn's tool boundary (pi 0.84.4+, which fixed the mid-run append that made Anthropic requests 400). Peer ranges stay `*`, so there is no enforced floor: on pi ≤0.84.3 this option shape is unsafe (≤0.84.1 steers the active run; 0.84.2–0.84.3 appends mid-run and 400s). This release is developed and tested against pi 0.87.0, which the devDependencies pin.

Previously these messages waited for the next user prompt: nothing appeared in the UI and nothing entered model context until the user typed again.

Also bumps the tested pi toolchain to 0.87.0 (devDependencies only; peer ranges remain `*`).
