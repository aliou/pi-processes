---
"@aliou/pi-processes": patch
---

Render log lines through one shared helper in the `/ps` preview, the `/ps:logs` overlay, and the dock. The three views each had their own copy of sanitize, truncate, and stream/match toning, which is how the overlay and preview ended up missing sanitization in the first place. The dock now shows process colors like the other two views.
