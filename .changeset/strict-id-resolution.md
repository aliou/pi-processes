---
"@aliou/pi-processes": minor
---

Process lookup now uses exact ID matching only. Fuzzy name/command matching via `find()` has been removed. The `id` parameter in tool actions accepts only the process ID returned by `start` and `list`. The `/ps` list UI merges the ID and Name columns into a single "Process" column showing `name (id)`.
