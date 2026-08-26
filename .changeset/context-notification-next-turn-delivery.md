---
"@aliou/pi-processes": patch
---

Fix session corruption when `context`/`ignore` notifications fire mid tool call. Pi appends non-turn custom messages directly into message history, so one arriving between an assistant `tool_use` and its pending `tool_result` made every later Anthropic request 400 until compaction or `/new`. These notifications now use `nextTurn` delivery, which safely defers them until the next user prompt. `turn` notifications are unaffected.
