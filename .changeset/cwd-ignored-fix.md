---
"@aliou/pi-processes": patch
---

Fix cwd parameter being ignored on process start

The process tool always used the session working directory (ctx.cwd)
when spawning processes, ignoring the cwd parameter passed by the LLM.
This caused commands with relative paths to fail when a different
working directory was specified.
