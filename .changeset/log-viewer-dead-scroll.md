---
"@aliou/pi-processes": patch
---

Fixed a dead zone in the `/ps:logs` overlay where up to a screenful of
scroll keypresses could be swallowed. The clamped viewport end is now
written back to the scroll anchor in both the truncated and full render
paths, so every keypress moves the view.
