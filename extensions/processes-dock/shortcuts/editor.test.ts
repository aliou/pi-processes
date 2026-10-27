import {
  createEventBus,
  type EventBus,
  type ExtensionUIContext,
  getSelectListTheme,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import type {
  CommandKillPayload,
  ProcessProtocolConfig,
} from "../../shared/protocol";
import { CHANNELS } from "../../shared/protocol";
import type { DockController } from "../widget/setup";
import { ProcessesShortcutsEditor } from "./editor";

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "\r";
const ESCAPE = "\x1b";

function makeProcess(
  id: string,
  status: ProcessInfo["status"] = "running",
  startTime = 1000,
): ProcessInfo {
  return {
    id,
    name: id,
    pid: 123,
    command: `echo ${id}`,
    cwd: "/repo",
    startTime,
    endTime: null,
    status,
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
  };
}

function defaultConfig(): ProcessProtocolConfig {
  return {
    execution: { shellPath: undefined },
    interception: { blockBackgroundCommands: false },
    processList: { maxPreviewLines: 12, maxVisibleProcesses: 8 },
    output: {
      defaultTailLines: 50,
      maxOutputLines: 1000,
      maxOutputBytes: 100_000,
    },
    follow: { enabledByDefault: true, autoHideOnFinish: true },
    widget: {
      showStatusWidget: true,
      dockDefaultState: "collapsed",
      dockHeight: 10,
    },
    shortcuts: { focusKey: "down" },
  };
}

interface Harness {
  editor: ProcessesShortcutsEditor;
  events: EventBus;
  setFocusedProcessId: (id: string | null) => void;
  focusedIds: string[];
  expanded: boolean;
  openLogs: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  killIds: string[];
  setKillFailure: (fails: boolean) => void;
  setText: (text: string) => void;
}

function createHarness(
  processes = [
    makeProcess("older", "running", 1000),
    makeProcess("newer", "running", 2000),
    makeProcess("finished", "exited", 500),
  ],
): Harness {
  const events: EventBus = createEventBus();
  const processList = processes;
  const config = defaultConfig();

  events.on(CHANNELS.REQUEST_LIST, (payload) => {
    (payload as { reply: (r: ProcessInfo[]) => void }).reply(
      processList.slice(),
    );
  });
  events.on(CHANNELS.REQUEST_CONFIG, (payload) => {
    (payload as { reply: (c: ProcessProtocolConfig) => void }).reply(config);
  });
  const killPayloads: CommandKillPayload[] = [];
  let killFails = false;
  events.on(CHANNELS.COMMAND_KILL, (payload) => {
    const command = payload as CommandKillPayload;
    killPayloads.push(command);
    command.reply({
      ok: !killFails,
      reason: "timeout",
      info: processList.find((p) => p.id === command.id) ?? makeProcess("x"),
    });
  });
  const focusedIds: string[] = [];
  let focusedProcessId: string | null = null;
  let expanded = false;
  const controller: DockController = {
    actions: {
      getFocusedProcessId: () => focusedProcessId,
      isFollowEnabled: () => true,
      setFocus: (id) => {
        focusedProcessId = id;
        if (id) focusedIds.push(id);
      },
      expand: () => {
        expanded = true;
      },
      collapse: () => undefined,
      close: () => undefined,
    },
    refresh: () => undefined,
    dispose: () => undefined,
  };

  const notify = vi.fn();
  const ui = { notify } as unknown as ExtensionUIContext;
  const tui = {
    requestRender: () => undefined,
    terminal: { rows: 48, columns: 220 },
  } as unknown as TUI;
  const editorTheme: EditorTheme = {
    borderColor: (text: string) => text,
    selectList: getSelectListTheme(),
  };
  const keybindings = {
    matches: () => false,
  } as unknown as KeybindingsManager;
  const openLogs = vi.fn();

  const editor = new ProcessesShortcutsEditor(tui, editorTheme, keybindings, {
    events,
    focusKey: config.shortcuts.focusKey,
    ui,
    getController: () => controller,
    openLogs,
  });

  return {
    editor,
    events,
    setFocusedProcessId: (id) => {
      focusedProcessId = id;
    },
    get focusedIds() {
      return focusedIds;
    },
    get expanded() {
      return expanded;
    },
    openLogs,
    notify,
    get killIds() {
      return killPayloads.map((command) => command.id);
    },
    setKillFailure: (fails) => {
      killFails = fails;
    },
    setText: (text) => editor.setText(text),
  };
}

describe("ProcessesShortcutsEditor", () => {
  it("focuses the first live process on down from an empty editor", () => {
    const h = createHarness();

    h.editor.handleInput(DOWN);

    expect(h.expanded).toBe(true);
    expect(h.focusedIds[0]).toBe("newer");
  });

  it("moves the selection with up and down", () => {
    const h = createHarness();
    h.editor.handleInput(DOWN);

    h.editor.handleInput(DOWN);
    expect(h.focusedIds.at(-1)).toBe("older");

    h.editor.handleInput(UP);
    expect(h.focusedIds.at(-1)).toBe("newer");
  });

  it("does not steal down when the editor has text", () => {
    const h = createHarness();
    h.setText("draft");

    h.editor.handleInput(DOWN);

    expect(h.focusedIds).toHaveLength(0);
  });

  it("opens the logs overlay for the selection on enter", () => {
    const h = createHarness();
    h.editor.handleInput(DOWN);
    h.editor.handleInput(DOWN);

    h.editor.handleInput(ENTER);

    expect(h.openLogs).toHaveBeenCalledWith("older");
  });

  it("stops the selected live process on x", () => {
    const h = createHarness();
    h.editor.handleInput(DOWN);

    h.editor.handleInput("x");

    expect(h.killIds).toEqual(["newer"]);
  });

  it("sanitizes the process name in the kill failure notification", async () => {
    const evil = makeProcess("evil", "running", 3000);
    evil.name = "\x1b]0;pwned\x07evil";
    const h = createHarness([evil]);
    h.editor.handleInput(DOWN);
    h.setKillFailure(true);

    h.editor.handleInput("x");
    await vi.waitFor(() => expect(h.notify).toHaveBeenCalled());

    const message = String(h.notify.mock.calls[0]?.[0]);
    expect(message).toContain("evil");
    expect(message).not.toContain("\x1b");
    expect(message).not.toContain("\x07");
  });

  it("exits focus without acting when the selection disappears", () => {
    const processes = [
      makeProcess("a", "running", 1000),
      makeProcess("b", "running", 2000),
    ];
    const h = createHarness(processes);
    h.setFocusedProcessId("b");
    h.editor.handleInput(DOWN);
    h.editor.handleInput(DOWN);

    processes.length = 0;
    processes.push(makeProcess("b", "running", 2000));
    h.editor.handleInput("x");

    expect(h.killIds).toHaveLength(0);
    expect(h.editor.getText()).toBe("");
    expect(h.focusedIds.at(-1)).toBe("b");
  });

  it("does not stop a finished process on x", () => {
    const h = createHarness();
    h.editor.handleInput(DOWN);
    h.editor.handleInput(DOWN);
    h.editor.handleInput(DOWN);

    h.editor.handleInput("x");

    expect(h.killIds).toHaveLength(0);
  });

  it("restores the previous pin on escape", () => {
    const h = createHarness();
    h.setFocusedProcessId("older");

    h.editor.handleInput(DOWN);
    h.editor.handleInput(ESCAPE);

    expect(h.focusedIds.at(-1)).toBe("older");
  });

  it("exits focus mode and types when another key is pressed", () => {
    const h = createHarness();
    h.editor.handleInput(DOWN);

    h.editor.handleInput("a");

    expect(h.editor.getText()).toBe("a");
  });
});
