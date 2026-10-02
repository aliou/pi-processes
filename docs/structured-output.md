# Structured output for the `process` tool

The `process` tool declares one `outputSchema` covering all seven actions and
returns `structuredContent` in every successful result. Codemode scripts that
call the nested tool receive the structured payload instead of the text
preview; the model-facing text `content` and the TUI `details` renderers are
unchanged.

## One declaration per shape

pi's `ToolDefinition` allows exactly one optional `outputSchema` per tool, so
per-action schemas at the tool level are impossible. The declared schema is a
discriminated union keyed on `action` —
`ProcessToolOutputSchema` in `extensions/processes/tools/schema.ts`,
assembled from one member schema per action. Each action's details type is the
`Static` of its member schema, and shared shapes are declared once next to
their owners instead of being re-described per consumer:

| shape | declared in | consumed by |
| ----- | ----------- | ----------- |
| `PROCESS_STATUSES`, `PROCESS_END_REASONS`, `ProcessSignalInfoSchema`, `ProcessInfoSchema` | `src/types.ts` | status enum unions, every member that embeds a process, list's `ListProcessSchema` |
| `LINE_MATCH_MODES` | `src/utils/match-line.ts` | matcher/matcher schemas on both sides |
| `PROCESS_PROTOCOL_ATTENTIONS` | `extensions/shared/protocol/notifications.ts` | notify attention fields everywhere |
| `LogMatcherConfigSchema`, `NotifyConfigSchema` | `extensions/processes/notifications/registry.ts` | tool input (`tools/schema.ts`), `start`/`update`/`list` members, `WatchUpdateItemParams` |
| `PROCESS_*` input tuples (streams, list filters/sorts, watch-update modes) | `extensions/processes/tools/schema.ts` | input params + their own members |
| member schemas → details types (`StartDetails`, `ListDetails`, …) | `extensions/processes/tools/schema.ts` | action executors return them; dispatcher passes them as `structuredContent` |

The tool input reuses the registry schemas directly (`NotifyParams` is
`Type.Object(NotifyConfigSchema.properties, …)`), so the model-facing notify
parameters, the runtime registry config, and the structured output are the
same object shape by construction.

pi renders the union into codemode's tool declarations (roughly 2 KB of
TypeScript text in the system prompt while codemode is active). Keep field
descriptions sparse and drop them if that ever matters.

## Drift protection is compile-time only

pi validates tool *inputs* against `parameters` before `execute` runs, but it
never validates `structuredContent` against `outputSchema` at runtime — the
schema is a declaration for programmatic callers, not an enforced gate.

Because every details type is the `Static` of its member schema, the details
types *cannot* drift from them; the executors are typed to build them and the
dispatcher feeds details straight into `structuredContent`
(`extensions/processes/tools/index.ts`). Compile-time drift only exists for
types we do not own, and exactly one remains:

- **pi's `TruncationResult`** (pi ships a TS interface, not a schema; an
  interface cannot be used to build a runtime schema) is translated by
  `OutputTruncationSchema` (minus pi's `content` field). The const-destructure
  of the truncation in `executeOutput`
  (`extensions/processes/tools/output/index.ts`) assigns pi's value into the
  derived `OutputDetails`; when pi's interface changes, that assignment is
  the first thing that fails typecheck.

## The `output` split: transcript vs ephemeral channel

The `output` member is the one whose schema is not a verbatim mirror of its
details. pi persists `details` in the durable session transcript but never
persists `structuredContent` (it only reaches nested codemode callers), and a
raw selection can hold up to 2000 unstripped lines per stream — so the arrays
deliberately stay out of `OutputDetails` (`Omit<Static<typeof
ProcessOutputSchema>, "stdout" | "stderr">`) and travel only through
`buildOutputStructuredContent`:

- `stdout`/`.stderr` line arrays are bounded by `tailLines` (at most 2000
  lines per stream, `MAX_OUTPUT_TAIL_LINES` in `extensions/processes/tools/schema.ts`)
  and the discovery scan window (`MAX_OUTPUT_SCAN_LINES`, 5000 lines), **not**
  by `MAX_OUTPUT_BYTES`. The structured payload can therefore exceed the
  model-facing preview; this mirrors pi's `bash` tool, whose structured output
  is likewise bounded by its own cap (1 MiB) rather than the preview limit.
- `truncation` still describes only the model-facing preview. It is the
  `TruncationResult` metadata (minus `content`) that `executeOutput` already
  attaches when the preview was truncated, both in details and in the payload.
- Lines are raw and unstripped: ANSI sequences and full-width lines survive,
  exactly as the selection stored them. The preview strips ANSI; the structured
  lines do not.

`output/index.test.ts` guards the transcript side of the split (details never
contain the line arrays; the serialized `{content, details}` stay under the
96 KiB bound). The payload side is covered by
`schema.test.ts`, including a compile-time probe that every
non-output details object is assignable to the union.

## Exposure stays `direct`

`process` keeps its default `direct` exposure and is not made `model-only`,
even though codemode scripts can call it:

- nested calls run through the same input validation, `tool_call`/`tool_result`
  hooks, and permission checks as direct model calls — there is no permission
  gap in keeping it scriptable.
- a codemode script that wants a background process can spawn one unmanaged
  via `bash` anyway; `model-only` would only trade managed starts (logs,
  watches, notifications, dock) for unmanaged ones.
- pi's guidance reserves `model-only` for tools that orchestrate other tools or
  ask the user; `process` does neither.
- read-only `list` and `output` calls are legitimately scriptable.

Permission extensions that want to gate script-issued calls can key on
`parentToolCallId` in `tool_call`/`tool_result` events.

## What each consumer receives

| consumer | receives |
| -------- | -------- |
| the model | `content` text — bounded previews with headers and guidance, unchanged |
| codemode scripts | `structuredContent` — the union payload above, instead of text |
| TUI renderers | `details` via `renderCall`/`renderResult` — unchanged; persisted in the session transcript |
| error paths | thrown calls never emit `structuredContent`; `isError` results keep `details` for the UI |
