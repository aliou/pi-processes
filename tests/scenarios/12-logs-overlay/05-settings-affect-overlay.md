Start a background process named "overlay-settings" that runs `bash ./tests/e2e/scripts/numbered-lines.sh`. Use the process tool. Wait until it emits several lines, then list processes and include the process id in your response.

I will manually open `/ps:settings`, open the Logs overlay detail panel, adjust tabs/history/viewport/follow settings, then reopen `/ps:logs <process-id>` to verify the overlay uses those settings.
