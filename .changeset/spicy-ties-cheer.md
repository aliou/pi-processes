---
"@aliou/pi-processes": patch
---

Tweak process output and watch matcher rendering.

Collapsed process output now separates the header from the preview with an
empty line, and the `filter:` label uses a distinct tone from the pattern
value. Pattern filters are quoted: double quotes for literal matches, single
quotes when the literal contains a double quote, and slashes for regex.
Expanded watch matcher lines in `start` and `update` apply the same quoting.
