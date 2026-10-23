---
"@aliou/pi-processes": minor
---

Add a `toolExposure` setting (`direct` by default) that controls how the `process` tool is registered, using pi's full `ToolExposure` set: `direct`, `model-only`, `codemode`, `deferred`, or `hidden`. `deferred` keeps the tool callable and discoverable via tool search but leaves the always-on tool list, so sessions that never manage processes stop paying the tool's declaration cost; `model-only` and `hidden` make the tool unreachable. The value is read at extension load, so changing it in `/ps:settings` applies on the next session start. Existing settings files are migrated to an explicit `toolExposure: "direct"`.
