---
"@aliou/pi-processes": minor
---

Add `write` action to write to process stdin

The process tool now supports writing to a running process's stdin:

- `process action=write id=proc_1 input="hello\n"` - write data to stdin
- `process action=write id=proc_1 input="quit\n" end=true` - write and close stdin

Useful for interactive programs, testing RPC mode, and any scenario requiring input to be sent to a background process.
