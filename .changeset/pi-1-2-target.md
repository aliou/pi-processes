---
"@aliou/pi-processes": minor
---

Target pi 1.2.0 and drop the idle-host wake workaround. Turn notifications now always go through Pi's steer path: on an idle host the notification starts a new run directly, and pi 1.2.0 emits `before_agent_start` for runs started by custom messages ([earendil-works/pi#10739](https://github.com/earendil-works/pi/pull/10739)), so handler-added system prompt sections survive the run. On pi ≤1.1.x an idle steer wake still skips `before_agent_start` ([#121](https://github.com/aliou/pi-processes/issues/121)), so upgrade pi before upgrading this package.
