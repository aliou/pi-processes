---
"@aliou/pi-processes": minor
---

Add an adopt API so other extensions can hand an already-running child process over to the manager. `ProcessManager.adopt(name, command, cwd, child, { initialOutput, startTime })` registers an externally spawned child (detached process group, piped stdio) as a managed process, and the new `processes:command:adopt` event-bus channel exposes it cross-extension. Adopted processes get the full managed lifecycle: log capture (including output produced before the handover), liveness watching, kill/stop, notifications, and dock/`/ps` visibility. This enables tools like a bash override that moves a long-running foreground command into the background without losing output.
