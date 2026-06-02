---
"@victor-software-house/pi-processes": minor
---

Add opt-in silence-based stall watchdog (`config.stall.enabled`, default off).

When enabled, a per-process timer fires after `config.stall.silenceSeconds`
(default 45) of no output from a running process. The wake is delivered as
`steer` with `triggerTurn: true`, alerting the agent that a process may be
waiting for input or hung. The timer resets on new output, so a single
stalled process triggers exactly one alert per silence window.
