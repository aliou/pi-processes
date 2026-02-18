import {
  createPanelPadder,
  renderPanelRule,
  renderPanelTitleLine,
} from "@aliou/pi-utils-ui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { type Component, matchesKey } from "@mariozechner/pi-tui";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { statusIcon, statusLabel } from "./status-format";

/**
 * A simple process picker component. Shows a list of processes and lets the
 * user select one with up/down + Enter, or dismiss with Escape/q.
 */
export class ProcessPickerComponent implements Component {
  private tui: { requestRender: () => void };
  private theme: Theme;
  private onClose: (processId?: string) => void;
  private manager: ProcessManager;
  private title: string;
  private filter: (proc: ProcessInfo) => boolean;

  private selectedIndex = 0;
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    tui: { requestRender: () => void },
    theme: Theme,
    onClose: (processId?: string) => void,
    manager: ProcessManager,
    title: string,
    filter?: (proc: ProcessInfo) => boolean,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.onClose = onClose;
    this.manager = manager;
    this.title = title;
    this.filter = filter ?? (() => true);

    this.unsubscribe = this.manager.onEvent(() => {
      this.invalidate();
      this.tui.requestRender();
    });
  }

  private getProcesses(): ProcessInfo[] {
    return this.manager.list().filter(this.filter);
  }

  handleInput(data: string): boolean {
    const processes = this.getProcesses();

    if (matchesKey(data, "down") || data === "j") {
      if (processes.length > 0) {
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          processes.length - 1,
        );
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    if (matchesKey(data, "up") || data === "k") {
      if (processes.length > 0) {
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    if (matchesKey(data, "return")) {
      if (processes.length > 0 && this.selectedIndex < processes.length) {
        const proc = processes[this.selectedIndex];
        if (proc) {
          this.unsubscribe?.();
          this.unsubscribe = null;
          this.onClose(proc.id);
        }
      }
      return true;
    }

    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.onClose();
      return true;
    }

    return true;
  }

  invalidate(): void {
    this.cachedWidth = 0;
    this.cachedLines = [];
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedLines.length > 0) {
      return this.cachedLines;
    }

    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const accent = (s: string) => theme.fg("accent", s);

    const padLine = createPanelPadder(width);

    const lines: string[] = [];
    const processes = this.getProcesses();

    lines.push(renderPanelTitleLine(this.title, width, theme));

    if (processes.length === 0) {
      lines.push(padLine(""));
      lines.push(padLine(dim("No processes available")));
      lines.push(padLine(""));
    } else {
      lines.push(padLine(""));
      for (let i = 0; i < processes.length; i++) {
        const proc = processes[i];
        if (!proc) continue;
        const isSelected = i === this.selectedIndex;
        const icon = statusIcon(proc.status, proc.success);
        const label = statusLabel(proc);
        const prefix = isSelected ? accent("> ") : "  ";
        const name = isSelected ? accent(proc.name) : proc.name;
        const id = dim(`(${proc.id})`);
        const status = dim(`${icon} ${label}`);
        lines.push(padLine(`${prefix}${name} ${id} ${status}`));
      }
      lines.push(padLine(""));
    }

    // Footer
    lines.push(renderPanelRule(width, theme));
    lines.push(
      padLine(
        `${dim("j/k")} select  ${dim("enter")} confirm  ${dim("q")} cancel`,
      ),
    );
    lines.push(renderPanelRule(width, theme));

    this.cachedLines = lines;
    this.cachedWidth = width;
    return this.cachedLines;
  }
}
