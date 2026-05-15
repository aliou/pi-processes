# Error paths

This scenario verifies safe behavior for no-op and invalid requests.

## Setup

Load the local extension in Pi. No project files or scripts are required.

## Expected result

The agent reports the process list without changing it, and stopping a missing process returns a clear failure result instead of crashing.
