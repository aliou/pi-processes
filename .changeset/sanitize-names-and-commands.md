---
"@aliou/pi-processes": patch
---

Sanitize and width-truncate every place that renders process-controlled text: the `/ps` list, the dock tab strip, log labels and status widget, the pickers and completions, `/ps:kill` notifications, the plain-mode process lists, the process tool renders, and the notification summary. A name, command, or matched log line carrying an escape sequence could otherwise drive the terminal.

Commands and names are now measured in terminal cells rather than JavaScript characters, so a wide-character name no longer draws 21 columns in a 12-column dock tab and emoji are no longer cut mid-surrogate. Colors cut off by truncation are re-closed instead of bleeding into the rest of the frame.
