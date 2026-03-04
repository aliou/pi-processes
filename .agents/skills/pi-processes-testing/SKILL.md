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

## Northwind Test Environment

All process testing uses the **Northwind** fixture -- a fake Node.js project with shell scripts that simulate real behavior. See the `demo-setup` skill for the full Northwind reference.

### Setting up a test environment

```bash
test_dir="$HOME/tmp/$(date +%Y-%m-%d)-processes-test"
mkdir -p "$test_dir/northwind/.pi/prompts"
mkdir -p "$test_dir/northwind/scripts"
```

Register the extension in `northwind/.pi/settings.json`:

```json
{
  "packages": [
    "/Users/alioudiallo/code/src/pi.dev/pi-processes"
  ],
  "defaultThinkingLevel": "off"
}
```

### Key scripts for testing

Copy from an existing Northwind fixture or create these:

| Script | Behavior | Tests |
|--------|----------|-------|
| `server.sh` | Long-running with periodic stdout | Background process, dock logs, output action |
| `dev.sh` | Long-running with HMR output | Multiple concurrent processes, dock interleaving |
| `test.sh` | Stateful: fail/fail/pass cycle | alertOnFailure, output inspection, re-run |
| `build.sh` | Finite, exits 0 | alertOnSuccess, process completion |
| `migrate.sh` | Exits 0, creates marker file | Foreground execution |
| `lint.sh` | Exits 1 with errors | Failure display, stderr |
| `reset.sh` | Clears `/tmp/northwind-*` markers | Idempotent re-runs |

### Stateful test flow

The test script checks marker files to determine behavior:
1. No `/tmp/northwind-migrated` -> fails with missing table error
2. No `/tmp/northwind-seeded` -> fails with missing seed data
3. Both present -> all tests pass

Always run `npm run reset` before a test session.

## Prompt workflow

1. Create a prompt file in `northwind/.pi/prompts/`:
   - Name it after the scenario: `test-shipping-feature.md`, `concurrent-processes.md`
   - Body: only the actionable steps, no headers or meta
2. Prompt must instruct the agent to use npm scripts (not raw shell commands)
3. Prompt should tell the agent to not wait for confirmation between steps

## Example test prompts

### Testing the shipping feature workflow

Tests: process start, foreground execution, output reading, failure handling, re-runs.

```markdown
---
description: Test the shipping feature workflow
---

Run through all steps without waiting for confirmation. Keep messages short.

## 1. Start the server
Start `npm run server` (name: "api-server") as a background process.

## 2. Run tests
Run `npm run test` in the foreground. Note the error.

## 3. Run migrations
Run `npm run migrate` in the foreground. Check server logs to confirm restart.

## 4. Run tests again
Run `npm run test` in the foreground. Note the different error.

## 5. Fix and re-run
Run `npm run seed`, then `npm run test`. Tests should pass.

## 6. Clean up
Kill all processes and clear.
```

### Testing concurrent processes

Tests: multiple background processes, dock log interleaving, list action.

```markdown
---
description: Test concurrent background processes
---

Run through all steps without waiting for confirmation.

## 1. Start services
Start `npm run server` (name: "api-server") and `npm run dev` (name: "dev-server") as background processes.

## 2. Run build and tests
Start `npm run build` (name: "build", alertOnSuccess) and `npm run test` (name: "tests", alertOnFailure).

## 3. React to alerts
Handle each alert as it comes in.

## 4. List processes
Show all processes.

## 5. Clean up
Kill all and clear.
```

## Manual QA checklist

### Dock

- Dock appears when processes start (follow mode)
- `Ctrl+Shift+P` toggles dock visibility
- `h/l` switches focused process
- `f` toggles focus mode (single process filter)
- `Shift+F` toggles follow mode
- `x` kills focused process
- `q` closes/unfocuses dock

### /ps overlay

- `/ps` opens full panel
- `j/k` selects process
- `J/K` scrolls logs
- `enter` focuses selected process
- `x` kills selected process
- `c` clears finished processes
- `q` quits

### /ps:logs overlay

- `/ps:logs` opens overlay directly
- `Tab`/`Shift-Tab` switches tabs
- `j/k` scrolls
- `f` toggles follow mode
- Search: `/` enters search, `Enter` activates, `n/N` cycles, `Esc` clears
- Current match highlight is stronger than non-current matches

## Reporting format

When reporting test results:
- Prompt file used
- Pass/fail per checklist item
- Exact reproduction steps for failures
- Expected vs actual behavior
