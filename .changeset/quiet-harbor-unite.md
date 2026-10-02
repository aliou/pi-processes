---
"@aliou/pi-processes": minor
---

Adopt pi's structured tool-output contract for the `process` tool

The `process` tool now declares `ProcessToolOutputSchema`, a single union schema discriminated by `action` (pi allows one `outputSchema` per tool, so per-action schemas are impossible), and every action returns `structuredContent` alongside the model-facing text. Codemode scripts that call the nested process tool receive structured objects instead of parsing the text preview; model-facing `content` and the TUI renderers are unchanged.

Every shape is declared once, schema-first: shared shapes live next to their owners — `ProcessInfoSchema` and the status/reason tuples in `src/types.ts`, the log-matcher/notify schemas in the notifications registry, match modes in `src/utils/match-line` — and each action's details type is *derived* from its member schema (`Static`), so the input schema, runtime config, details types, and structured output cannot drift apart. The only hand-kept translation left is pi's `TruncationResult` (a TS interface, not a schema), mirrored for the output truncation and enforced at its single assignment site.

The `output` action's payload additionally carries the raw filtered selection lines behind the preview, bounded by `tailLines` (≤2000 per stream) and the 5000-line scan window rather than the preview byte limit, mirroring pi's `bash` contract. Those line arrays live only in `structuredContent`: pi persists `details` in the session transcript but never persists `structuredContent`, so the transcript entry stays bounded while codemode callers get the full selection. `truncation` still describes only the model-facing preview.

Also bumps the tested pi toolchain to 1.0.0 (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`; devDependencies only, peer ranges remain `*` and optional). `typebox` stays at 1.3.27, the exact version pi 1.0.0 bundles.
