import {
  CustomEditor,
  type EventBus,
  type ExtensionUIContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  Key,
  type KeyId,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";
import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { truncateForDisplay } from "../../shared/display-text";
import { requestKill, requestProcessList } from "../client";
import type { DockController } from "../widget/setup";
import { sortProcesses } from "../widget/setup";
import { ProcessFocus } from "./focus-mode";

export interface ProcessesShortcutsEditorOptions {
  events: EventBus;
  focusKey: string;
  ui: ExtensionUIContext;
  getController: () => DockController | null;
  openLogs: (processId: string) => void;
}

export class ProcessesShortcutsEditor extends CustomEditor {
  private readonly events: EventBus;
  private readonly focusKey: string;
  private readonly ui: ExtensionUIContext;
  private readonly getController: () => DockController | null;
  private readonly openLogs: (processId: string) => void;
  private readonly focus = new ProcessFocus();

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    options: ProcessesShortcutsEditorOptions,
  ) {
    super(tui, theme, keybindings);
    this.events = options.events;
    this.focusKey = options.focusKey;
    this.ui = options.ui;
    this.getController = options.getController;
    this.openLogs = options.openLogs;
  }

  handleInput(data: string): void {
    if (this.focus.isActive) {
      this.handleFocusInput(data);
      return;
    }
    if (this.shouldEnterFocus(data)) {
      this.enterFocus(data);
      return;
    }
    super.handleInput(data);
  }

  private shouldEnterFocus(data: string): boolean {
    if (this.focusKey.length === 0) return false;
    if (!matchesKey(data, this.focusKey as KeyId)) return false;
    if (this.getText().length > 0) return false;
    return !this.isShowingAutocomplete();
  }

  private enterFocus(data: string): void {
    const controller = this.getController();
    const processes = sortProcesses(requestProcessList(this.events));
    if (!controller || processes.length === 0) {
      super.handleInput(data);
      return;
    }
    this.focus.enter(processes, controller.actions.getFocusedProcessId());
    controller.actions.expand();
    this.applySelection(processes);
  }

  private handleFocusInput(data: string): void {
    const processes = sortProcesses(requestProcessList(this.events));
    if (!this.focus.select(processes)) {
      this.exitFocus(true);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.focus.move(-1, processes);
      this.applySelection(processes);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.focus.move(1, processes);
      this.applySelection(processes);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.openSelectedLogs(processes);
      return;
    }
    if (matchesKey(data, "x")) {
      this.killSelected(processes);
      return;
    }
    this.exitFocus(true);
    super.handleInput(data);
  }

  private applySelection(processes: ProcessInfo[]): void {
    const selected = this.focus.select(processes);
    this.getController()?.actions.setFocus(selected?.id ?? null);
    this.tui.requestRender();
  }

  private openSelectedLogs(processes: ProcessInfo[]): void {
    const selected = this.focus.select(processes);
    this.exitFocus(false);
    if (selected) this.openLogs(selected.id);
  }

  private killSelected(processes: ProcessInfo[]): void {
    const selected = this.focus.select(processes);
    if (!selected || !LIVE_STATUSES.has(selected.status)) return;
    void requestKill(this.events, selected.id).then((result) => {
      if (!result.ok) {
        const name = truncateForDisplay(selected.name, 40);
        this.ui.notify(`Failed to stop ${name}: ${result.reason}.`, "warning");
      }
    });
  }

  private exitFocus(restore: boolean): void {
    const controller = this.getController();
    const restoredId = this.focus.exit();
    if (restore && controller) controller.actions.setFocus(restoredId);
    this.tui.requestRender();
  }
}
