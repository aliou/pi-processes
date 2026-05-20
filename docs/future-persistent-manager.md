# Future Persistent Manager

Phase 1 intentionally does not keep processes alive across `/reload`, `/new`, or `/fork`. The core extension owns one `ProcessManager` in its extension closure and shuts it down with `manager.killAll()` and `manager.cleanup()` during `session_shutdown`.

This document describes how to add cross-session persistence later if we decide the UX is worth the extra lifecycle complexity.

## Assumptions

- `ProcessManager` should stay Pi-agnostic. It should not know about sessions, reloads, extension APIs, settings, or `globalThis`.
- Persistence is an extension lifecycle policy, not a per-process option and not a tool parameter.
- UI extensions should still talk to the core extension through `pi.events`; they should not import the manager.
- All Pi event listeners must still be disposed on `session_shutdown`, even when the manager survives.

## Recommended Design

Keep the singleton outside `src/manager`. Add a small lifecycle module in the core extension layer, for example `extensions/processes/manager-lifetime.ts`.

That module can own:

- A `globalThis` key such as `Symbol.for("@aliou/pi-processes/core-manager")`
- A record containing `{ manager, generation, getConfiguredShellPath }`
- Functions such as `getExtensionManager({ persistent, getConfiguredShellPath })` and `shutdownExtensionManager({ persistent, manager })`

For non-persistent mode, return a fresh manager and require the extension shutdown hook to kill and clean it up.

For persistent mode, store the manager on `globalThis` and return the existing instance on reload. Do not store Pi APIs, event buses, config objects, or UI subscribers globally. Those belong to the current extension instance and must be recreated every reload.

## Shutdown Rules

On `session_shutdown`:

1. Remove all Pi listeners and manager event bridge listeners for the current extension instance.
2. Clear any log subscriber maps owned by the current extension instance.
3. If persistence is disabled, call `manager.killAll()` and `manager.cleanup()`.
4. If persistence is enabled, leave the manager running but do not leave stale Pi callbacks attached to it.

On actual Node process exit, kill all live processes regardless of persistence. Persistence should only survive Pi session reloads, not application exit.

## Tests To Add

- Persistent reload returns the same manager instance.
- Persistent shutdown removes listeners but does not call `killAll()`.
- Non-persistent shutdown calls `killAll()` and `cleanup()` on the extension-owned manager.
- Reloading the core extension does not duplicate event bridge notifications.
- Config changes still affect shell selection through a lazy `getConfiguredShellPath` callback.
- UI log subscribers are not persisted and must re-subscribe after reload.

## Known Footgun

Do not add a `shutdownManager(false)` helper that looks only in `globalThis`. A non-persistent manager is usually owned by the extension closure, so a global-only shutdown helper cannot find it. Either pass the active manager to shutdown or keep shutdown in the extension disposer that already closes over that manager.
