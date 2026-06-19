Start a background process named "dock-repeat" with the process tool. It should repeatedly print the exact same line "dock tick" several times per second and keep running.

Do not stop it. After the process starts, list it and include its process id in your response.

After the agent responds, I will manually test:

1. `/ps:dock open` shows the dock.
2. `/ps:pin <dock-repeat-id>` pins the process.
3. Repeated identical output is coalesced in the log tail instead of filling the dock with duplicate lines.
4. `/ps:dock collapse` still shows a compact last-line preview.
