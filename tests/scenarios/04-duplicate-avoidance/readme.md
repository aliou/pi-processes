# Duplicate avoidance

This scenario verifies that the agent lists processes before starting a named background process, avoiding duplicates when one already exists.

## Setup

Load the local extension in Pi. No project files or scripts are required.

## Expected result

Running the prompt once starts `dev-server`. Running it again should not start a second `dev-server`.
