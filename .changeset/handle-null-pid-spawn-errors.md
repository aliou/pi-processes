---
"@aliou/pi-processes": patch
---

Handle async spawn errors on failed starts. When a spawn fails during initialization (e.g. a non-existent cwd), the child has no pid and emits its `error` event asynchronously; the null-pid path now attaches an error listener so the failure is captured on the record (real `ENOENT`/`EACCES` reason) instead of crashing the host via `uncaughtException`.
