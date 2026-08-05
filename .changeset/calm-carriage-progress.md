---
"@aliou/pi-processes": patch
---

Render carriage-return progress output as the final visible update in `/ps:logs` and the dock.

Log watches now match the same plain visible line shown in the UI, so hidden CR-overwritten text, dropped escape payloads, and invisible styling bytes no longer trigger notifications.
