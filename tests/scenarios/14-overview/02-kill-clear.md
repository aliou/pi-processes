Start two background processes with the process tool:

1. Name "overview-kill" and run `bash ./tests/e2e/scripts/continuous-output.sh`.
2. Name "overview-done" and run `bash ./tests/e2e/scripts/exited-task.sh` (a short command that exits successfully).

Do not stop them. After the agent starts both, list processes and include their ids in your response.

After the agent responds, I will manually test:

1. `/ps` opens the overview panel.
2. `j/k` selects the finished process; `x` on the running process kills it and the list updates.
3. `c` clears the finished process and the list updates immediately.
4. After clearing, the empty-state appears when no processes remain.
5. `q` closes the panel.
