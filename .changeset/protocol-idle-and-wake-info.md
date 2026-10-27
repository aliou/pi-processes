---
"@aliou/pi-processes": patch
---

Expose idle-at-delivery and remaining wake conditions over the extension protocol. Persisted `ad-process:notification` message details now record `sessionIdle`, whether the Pi session was idle when the notification was delivered, so saved history can distinguish a completion that woke an idle session from one steered into an active run. The `processes:request:list` reply now carries a `wake` field per process with a notification config: the resolved exit attentions (`success`/`failure`/`killed`) and every configured log watch with whether it has already fired, so clients can tell when an idle session can still be woken by a process. Both fields are additive; delivery behaviour is unchanged.
