# Dock widget

These scenarios verify the `/ps:dock` and `/ps:pin` commands from the dock extension.

## Setup

Load the local extension in Pi. Run each scenario prompt from the project root so the script paths resolve correctly.

Process start is LLM-only. Send the scenario prompt to the agent, then use the listed manual UI steps after the agent starts the processes.

## Expected result

The agent starts managed processes with the `process` tool. The user can show, hide, collapse, open, and pin the dock. The dock uses the core event protocol and log subscription protocol, so it should update live without importing the core process manager.

## Manual checklist

- `/ps:dock expand` shows a framed dock above the editor.
- `/ps:dock collapse` shows compact rows with process previews.
- `/ps:dock close` removes the dock.
- `/ps:pin <process-id>` selects which process the dock shows and opens the dock.
- Open mode streams live output for the pinned process.
- Collapsed mode updates last-line previews.
- No widget is rendered below the editor; the dock is the above-editor widget.
- Notification log matches show a process-row badge and highlighted matching log lines.
- Finished and failed processes use distinct glyphs.
- Closing or hiding the dock unsubscribes from live logs cleanly.
