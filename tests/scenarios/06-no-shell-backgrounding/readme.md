# No shell backgrounding

This scenario verifies that the agent follows the process tool prompt guidance and does not use shell background patterns to start long-running commands.

## Setup

Load the local extension in Pi. No project files or scripts are required.

## Expected result

The agent starts `no-shell-backgrounding` with the `process` tool and does not use `&`, `nohup`, `disown`, or `setsid`.
