# Multiple processes

This scenario verifies that the agent can manage more than one tracked background process and stop a specific process without stopping unrelated ones.

## Setup

Load the local extension in Pi. No project files or scripts are required.

## Expected result

The agent starts `api-server` and `worker`, lists both, stops only `worker`, and confirms `api-server` remains tracked.
