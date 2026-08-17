# docs

Evergreen documentation and design notes for `pi-processes`. Current behavior and architecture live here; proposed or unsettled work is marked in the file itself.

## Index

- `notifications.md` — how process lifecycle and log-watch events become agent notifications: the two-layer fanout, per-process notify config and defaults, attention-level mapping, forced display for crashes/failures, the intentional-stop config bypass, the `terminate_timeout` non-emit path, and log-match matching and rate limiting. Includes per-end-state call stacks and a summary matrix.
- `future-persistent-manager.md` — proposed design for keeping processes alive across `/reload`, `/new`, and `/fork`.
- `future-cleanup-hooks.md` — proposed design for generic cleanup hooks run when a managed process stops.

## Upkeep

Update a doc when the flow, config, or attention rules it describes change. Anchor call-stack nodes to real symbols and plain repo paths, never line numbers. A stale call graph misleads worse than none — delete or fix it when the code drifts.
