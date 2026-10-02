---
"@aliou/pi-processes": patch
---

Fire `before_agent_start` for turns woken by process notifications on an idle host

When the host agent is idle, `turn` notifications are now persisted as displayed custom messages with `triggerTurn: false`, and the host is woken with a user message instead of a `triggerTurn` steer. A steer wake on an idle host starts the run through Pi's custom-message path, which never fires `before_agent_start` (#121), so the woken turn ran without system-prompt additions from that hook — and setups that require them rejected the request outright. The user-message wake goes through `pi.prompt()`, which fires `before_agent_start` like a user-typed prompt.

While a run is active — or before any host lifecycle event has been observed — delivery still steers the active run unchanged. The delivery listener tracks host idleness from the session lifecycle, where `agent_settled` is the idle signal (`ctx.isIdle()` is still false in `agent_end` and `turn_end` handlers), sends at most one wake until the woken run starts, and re-arms once the host is idle again.
