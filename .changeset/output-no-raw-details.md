---
"@aliou/pi-processes": patch
---

Fix issue #58: `process output` no longer persists raw stdout/stderr arrays in tool-result `details`. Output details now contain only metadata (action, success, message, log file paths, optional truncation info), while the bounded text preview is returned as tool-result `content`. Multi-megabyte single lines, CR-only progress output, and JSON-escaping expansion can no longer produce multi-megabyte session entries.
