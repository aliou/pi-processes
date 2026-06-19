Start a background process named "dock-notify" with the process tool. It should print "dock ready" after a short delay and then keep running.

Configure the process start notify options so a log matcher watches for "dock ready" and triggers an agent turn when it appears. Do not stop the process.

After the process starts, list it and include its process id in your response.

After the agent responds, I will manually test:

1. `/ps:dock open` shows the dock.
2. `/ps:pin <dock-notify-id>` pins the process.
3. When "dock ready" appears, the row shows a notification-match badge.
4. The matching log line is highlighted in the open dock.
5. The notification still appears as a process notification message.
