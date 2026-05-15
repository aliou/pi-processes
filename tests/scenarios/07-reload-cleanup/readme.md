# Reload cleanup

This scenario verifies that session shutdown cleanup kills managed processes when Pi reloads the extension.

## Setup

Load the local extension in Pi. No project files or scripts are required.

## Expected result

After running the prompt, manually run `/reload`. The `cleanup-check` process should be killed by the old extension instance during `session_shutdown`.
