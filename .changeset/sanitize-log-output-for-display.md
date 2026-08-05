---
"@aliou/pi-processes": patch
---

Sanitize process output before rendering it in the `/ps:logs` overlay and the `/ps` preview. Both paths rendered raw log text since the 0.10 rewrite, so cursor movement, screen erase, alternate-screen switches, scroll regions, OSC/DCS/APC strings, and stray carriage returns reached the terminal and could corrupt the whole screen. v0.9.5 stripped these at render; the rewrite dropped that step.

Escape sequences other than SGR colors are now removed, tabs are expanded so measured width matches drawn width, and colors are preserved (v0.9.5 dropped them). The dock gets the same treatment on top of its existing strip.
