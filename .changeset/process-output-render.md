---
"@victor-software-house/pi-processes": minor
---

Process output rendering now uses pi-render-core bash factories when available — Shiki syntax highlighting, boxed panel with exit status, elapsed timer, and width-aware visual truncation identical to Pi's native bash tool. Falls back to a themed Container-based renderer (toolOutput colors, truncateToVisualLines, expand hint) when pi-render-core is absent.
