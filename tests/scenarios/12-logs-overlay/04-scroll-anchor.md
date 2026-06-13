Start a background process named "overlay-scroll" that runs `bash ./tests/e2e/scripts/continuous-output.sh`. Use the process tool. Let it run long enough to emit many lines. Do not stop it.

After the process starts, I will manually open `/ps:logs`, scroll with `k` to older output, verify follow mode is disabled, wait for new output, and verify the visible log window stays anchored instead of jumping to the bottom.
