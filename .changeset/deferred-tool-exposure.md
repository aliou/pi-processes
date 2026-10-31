---
"@aliou/pi-processes": patch
---

Add a `toolExposure` setting that controls how the `process` tool is registered, using pi's full `ToolExposure` set (`direct`, `model-only`, `codemode`, `deferred`, or `hidden`; default `direct`). `deferred` leaves the always-on tool list, so sessions that never manage processes stop paying its declaration cost; the model then reaches the tool only through `tool_search` or codemode, so enable one of them before choosing it. Unknown stored values fall back to `direct`. It is a global setting, offered only in the Global tab of `/ps:settings`, and a change applies on the next session start.
