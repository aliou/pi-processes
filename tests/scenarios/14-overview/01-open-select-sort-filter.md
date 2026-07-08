Start three background processes with the process tool:

1. Name "overview-dev" and run `bash ./tests/e2e/scripts/continuous-output.sh`.
2. Name "overview-mixed" and run `bash ./tests/e2e/scripts/mixed-output.sh`.
3. Name "overview-fail" and run a short command that prints "overview failure" and exits with code 1.

Do not stop the running processes. After all starts complete, list processes and include their ids in your response.

After the agent responds, I will manually test:

1. `/ps` opens the overview panel replacing the editor.
2. All three processes appear with distinct status dots (running, running, failed).
3. `j/k` moves the selection and highlights the selected row.
4. The preview pane shows recent output for the selected process.
5. `J/K` scrolls the preview pane.
6. `s` cycles the sort and updates the header chips.
7. `f` cycles the filter between all, running, and finished.
8. `/` opens a quick filter; typing a name fragment narrows the list.
9. `q` closes the panel and restores the editor.
