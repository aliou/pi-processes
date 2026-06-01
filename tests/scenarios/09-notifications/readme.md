# Notifications

This scenario verifies process lifecycle and log-match notifications from the `process` tool.

## Setup

Load the local extension in Pi. No project files or scripts are required.

## Expected result

The agent uses the process tool for every process start and stop. Process notifications appear as custom process messages. Failure and log-match notifications should trigger an agent turn. Success notifications should be displayed as context without triggering a turn. Intentional stops should not create an extra killed notification.
