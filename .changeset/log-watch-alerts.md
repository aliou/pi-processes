---
"@aliou/pi-processes": minor
---

Add runtime log watch alerts for managed processes.

- New `logWatches` option on `process` tool `start` action
- Watches match log lines on `stdout`, `stderr`, or `both`
- Default one-time behavior (`repeat: false`), with optional repeat mode
- On watch match, emit visible UI event and trigger an immediate agent turn
- Invalid watch config (including bad regex patterns) now fails fast at start time
