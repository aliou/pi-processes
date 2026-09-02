---
"@victor-software-house/pi-processes": minor
---

Deliver process completion notices mid-turn and bound the finished-process list.

- Lifecycle completion (`process-end`) now sends `deliverAs: "steer"`, like output-pattern and stall wakes. Pi hands the notice to the agent after its current tool calls and before the next LLM call, instead of waiting until the agent is fully idle — so an agent that kept polling a process never saw the completion until it stopped.
- New `retention.maxFinished` setting (default 10, `0` = unbounded, also in `/ps:settings`): after every process end the manager drops the oldest finished records beyond the cap. Log files stay on disk, so paths returned by `start` and `logs` remain readable; `clear` still deletes them.
- The `process` tool description, prompt guidelines, skill, and `start` result now say which alerts apply and tell the model not to poll with `output`/`list`.
