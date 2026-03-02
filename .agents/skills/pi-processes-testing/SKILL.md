---
name: pi-processes-testing
description: Test workflows for the pi-processes extension. Use when validating /ps UI/UX changes, preparing reproducible test prompts, or running manual QA with test scripts while ensuring process start is done by the LLM (not the user).
---

# pi-processes-testing

## Rules

- Treat process start as LLM-only.
- Do not ask the user to run shell commands to start background processes.
- For UI tests, either:
  - provide a prompt the user sends to the agent, or
  - run automation via tmux.

## Prompt workflow

1. Create an indexed prompt file in `.pi/prompts/`:
   - format: `.pi/prompts/NN-short-name.md`
   - body: only the actionable prompt (no test title/header in prompt content)
2. Prompt must instruct the agent to start processes using test scripts under `test/`.
3. Ask the agent to confirm processes are running.

## Standard test scripts

Use these scripts as needed:

- `test/test-output.sh` (long-running stream, stdout+stderr)
- `test/test-exit-success.sh` (exits 0)
- `test/test-exit-failure.sh` (exits 1)
- `test/test-exit-crash.sh` (exits 137)

## Default prompt template

Use this body in `.pi/prompts/NN-*.md` and adapt names/scripts only:

Start three background processes:
- name "output", command `bash test/test-output.sh`
- name "success", command `bash test/test-exit-success.sh`
- name "crash", command `bash test/test-exit-crash.sh`

Tell me when they are all running.

## Manual QA checklist (overlay)

Validate at minimum:

- `/ps:logs` opens overlay directly (no pre-select step).
- `Tab`/`Shift-Tab` switches tabs.
- `j/k` direction is correct.
- `f` follow toggle freezes/resumes as expected.
- Search UX:
  - `/` enters search input,
  - `Enter` activates search,
  - `n/N` cycles matches,
  - `Esc` clears search (does not close overlay while search is active).
- Footer reflects current mode hints.
- Current match highlight is clearly stronger than non-current matches.

## Reporting format

When reporting test results, include:

- prompt file used
- pass/fail per checklist item
- exact reproduction steps for failures
- expected vs actual behavior
