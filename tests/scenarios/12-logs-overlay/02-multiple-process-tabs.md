Start two background processes with the process tool:

1. Name "overlay-out" and run `bash ./tests/e2e/scripts/continuous-output.sh`.
2. Name "overlay-mixed" and run `bash ./tests/e2e/scripts/mixed-output.sh`.

Do not stop them. After both processes start, list them and include their process ids in your response.

I will manually open `/ps:logs`, use Tab and Shift-Tab to switch between processes, then open `/ps:logs <process-id>` for one of the ids.
