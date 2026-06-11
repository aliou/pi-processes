# Update action

This scenario verifies the `process update` tool action for renaming a running process and mutating log watches (append, replace, remove, clear).

## Setup

Load the local extension in Pi. No project files or scripts are required. All scenarios start a process first, then update it.

## Expected result

The agent uses `process update` to rename processes and modify log watches on running processes. Updates on non-running processes should fail with a clear error. Watch mutations should take effect immediately for future output.
