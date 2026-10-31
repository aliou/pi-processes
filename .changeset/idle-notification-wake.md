---
"@aliou/pi-processes": patch
---

Turn notifications always use Pi's steer path: on an idle host the notification starts a new run directly, and pi emits `before_agent_start` for runs started by custom messages, so handler-added system prompt sections survive the run. The idle-host workaround that persisted turn notifications without a turn and woke the host with a bare user message is removed.
