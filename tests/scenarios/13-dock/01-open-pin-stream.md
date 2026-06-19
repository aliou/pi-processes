Start two background processes with the process tool:

1. Name "dock-out" and run `bash ./tests/e2e/scripts/continuous-output.sh`.
2. Name "dock-mixed" and run `bash ./tests/e2e/scripts/mixed-output.sh`.

Do not stop them. After both processes start, list them and include their process ids in your response.

After the agent responds, I will manually test:

1. `/ps:dock open` shows a framed dock with both processes.
2. `/ps:pin <dock-mixed-id>` pins the mixed-output process.
3. The dock log tail streams stdout and stderr live for the pinned process.
4. `/ps:dock collapse` shows compact rows with last-line previews.
5. `/ps:dock hide` removes the dock.
6. `/ps:dock toggle` brings it back.
