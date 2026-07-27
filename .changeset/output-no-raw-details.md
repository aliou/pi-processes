---
"@aliou/pi-processes": patch
---

Fix issue #58: `process output` no longer persists raw stdout/stderr arrays in tool-result `details`. Output details now contain only metadata, including optional truncation info, while the bounded text preview is returned as tool-result `content`.
