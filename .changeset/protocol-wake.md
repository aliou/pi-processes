---
"@aliou/pi-processes": minor
---

Extend the extension-to-extension protocol with wake information, owned by the process manager.

- The manager now owns per-process wake state (exit attentions, log watches with one-shot fired state, intentional-stop markers) through a new `ProcessWakeController` in `src/manager`. It evaluates log watches on process output and emits a new `process_watch_matched` manager event, and exposes `getWakeConditions(id)` and `listWithWake()`.
- `processes:request:list` replies now carry a `wake` field for each live process with its resolved exit attentions and its still-configured log watches, including whether a one-shot watch has already fired. Ended processes omit the field.
- Persisted `ad-process:notification` message details now record `sessionIdle`, whether the Pi session was idle when the notification was delivered, so saved history can distinguish a completion that woke an idle session from one steered into an active run. The payload broadcast on `processes:notification` is unchanged.
- The notification extension's registry and matcher state dissolve into the manager; the notification service now only shapes `processes:notification` payloads from manager events.
