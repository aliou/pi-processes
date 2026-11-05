---
"@aliou/pi-processes": patch
---

Fix `wordToString` dropping `$'...'` and `$"..."` arguments after the `@aliou/sh` 0.4.0 parser update: ANSI-C parts now render their decoded value, locale strings render their inner parts, and unknown word parts throw instead of stringifying to an empty argument.
