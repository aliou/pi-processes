# Stop flow

This scenario verifies that the agent can list tracked processes, stop a selected process with the `process` tool, and list again to confirm status changed.

## Setup

Run `tests/scenarios/01-basic-start-list/01-start-heartbeat.md` first, or otherwise ensure a process named `heartbeat` exists.

## Expected result

The agent stops only `heartbeat` and a follow-up list reflects the stopped process state.
