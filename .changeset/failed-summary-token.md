---
"@aliou/pi-processes": patch
---

Fold failed and killed processes into `! N failed` and `■ N killed` summary tokens in the status widget, mirroring the existing `✓ N done` token. A new failure stays individual until the next process starts, then folds into the summaries.
