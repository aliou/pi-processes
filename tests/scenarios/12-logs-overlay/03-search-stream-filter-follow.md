Start a background process named "overlay-search" that runs `bash ./tests/e2e/scripts/mixed-output.sh`. Use the process tool. Do not stop it.

After the process starts, I will manually open `/ps:logs`, search for `failed`, cycle stream filters with `s`, toggle follow mode with `f`, and verify stdout/stderr filtering changes the visible lines.
