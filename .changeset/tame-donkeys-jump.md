---
"@aliou/pi-processes": patch
---

Improve the expanded process notification message (log match or process end).

The expanded detail line now honors the `outputPad` setting instead of a
hardcoded value, no longer leaves a blank line between the summary and
detail line, and colors each field to match existing conventions elsewhere
in the extension (status/exit tone, accent pattern). Log match
notifications now surface the matched pattern and stream in the expanded
view, and kill notifications surface signal details.

The `attention` field is renamed to `notify` and reads in plain language
(`now` / `next turn` / `silent`) instead of the raw `turn` / `context` /
`ignore` enum. The log match `stream` field no longer repeats `literal` or
`regex`, since the pattern itself is now quoted (`"..."`) or slash-wrapped
(`/.../`) to show that.
