# Output action

This scenario verifies the `process output` tool action for inspecting recent stdout/stderr of background processes.

## Setup

Load the local extension in Pi. The shell scripts in `tests/e2e/scripts/` simulate various process output patterns. Run each scenario prompt from the project root so the script paths resolve correctly.

## Expected result

The agent uses `process output` to inspect running and finished processes. Stream filtering, pattern matching, and truncation should work as documented. Invalid regex should produce a clear tool error.
