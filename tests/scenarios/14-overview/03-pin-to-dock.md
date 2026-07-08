Start one background process with the process tool:

1. Name "overview-pin" and run `bash ./tests/e2e/scripts/continuous-output.sh`.

Do not stop it. After the process starts, list it and include its id in your response.

After the agent responds, I will manually test (with the dock extension loaded):

1. `/ps` opens the overview panel.
2. `j/k` selects the "overview-pin" process.
3. `enter` pins it to the dock; the dock appears above the editor expanded on the pinned process.
4. The dock shows live output for the pinned process.
5. `q` closes the overview panel; the dock stays pinned.

Then, with the dock extension NOT loaded:

1. `/ps` opens the overview panel.
2. `enter` on a process shows `pin (dock not loaded)` in the footer and does not pin.
