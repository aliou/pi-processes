Start one background process with the process tool:

1. Name "overview-survive" and run `bash ./tests/e2e/scripts/continuous-output.sh`.

Do not stop it. After the process starts, list it and include its id in your response.

After the agent responds, I will manually test:

1. `/ps` opens the overview panel and the single process is selected.
2. Start a second process by asking the agent to start another named "overview-second" running `bash ./tests/e2e/scripts/numbered-lines.sh`.
3. The overview panel updates live (via CHANNELS.CHANGED) without resetting selection to the top.
4. The originally selected process stays selected.
5. Stop the second process by asking the agent. The overview updates and selection is preserved on the still-running process.
6. `q` closes the panel.
