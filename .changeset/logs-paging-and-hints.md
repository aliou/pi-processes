---
"@aliou/pi-processes": minor
---

The `/ps:logs` overlay now supports page scrolling: `PageUp`/`PageDown`
move by a full viewport and `ctrl+u`/`ctrl+d` by half a viewport.

Footers (`/ps` overview and `/ps:logs` overlay) now render compact
shortcut hints: when a hint's key letter appears in its word, only the
word is shown with the key highlighted in accent + bold ("w wrap" becomes
"wrap"). When the hint list does not fit the footer width, a leading
"? more" affordance appears; pressing `?` opens a stacked shortcuts
overlay listing every available key.
