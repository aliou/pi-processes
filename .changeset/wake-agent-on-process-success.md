---
"@aliou/pi-processes": patch
---

Default `notify.onSuccess` to `turn` so a finished process wakes an idle agent.

Under v0.9.5 the flat `alertOnSuccess: true` boolean was clear enough that the agent set it on almost every start, so a completed build, test run, or encode always got a turn. The 0.10 rewrite replaced it with `notify.onSuccess`, defaulting to `context`, and the agent stopped opting in. `context` only reaches the agent if it happens to still be streaming when the process ends; an idle agent is never woken, so long one-shot commands finished silently and the user had to prod the agent.

Servers and watchers that should not interrupt on a clean exit can still pass `notify.onSuccess: "context"`.

The tool descriptions, prompt guidelines, and skill now state plainly that only `turn` reaches an idle agent, instead of claiming every exit notification brings the agent back.
