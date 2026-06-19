Start three managed processes with the process tool:

1. Name "dock-running" and run `bash ./tests/e2e/scripts/continuous-output.sh`.
2. Name "dock-error-log" and run `bash ./tests/e2e/scripts/error-log.sh`.
3. Name "dock-fail" and run a short command that prints "dock failure" and exits with code 1.

Do not stop the running processes. After all starts complete, list processes and include their ids in your response.

After the agent responds, I will manually test:

1. `/ps:dock collapse` shows running and failed processes with distinct glyphs.
2. `/ps:dock open` shows the framed dock and process table.
3. `/ps:pin <dock-error-log-id>` selects stderr-heavy output for the open dock.
4. No widget is rendered below the editor.
5. The failed process is counted as finished in collapsed mode.
