---
"@aliou/pi-processes": patch
---

Use one ANSI-safe `truncateToWidth` across every extension. Pi's version injects `ESC[0m` after the kept prefix and around the ellipsis, which ends a caller-applied background or foreground early and leaves the ellipsis and padding unstyled; it also mis-parses CSI sequences that do not end in `m`, `G`, `K`, `H`, or `J`, and can swallow visible text. The repo already had a corrected fork used by three tool renderers only. It now lives in `extensions/shared/truncate.ts`, has tests, and is used by the `/ps` overview, the `/ps:logs` overlay, and the dock as well.
