import type { Theme } from "@mariozechner/pi-coding-agent";
import { type Component, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { statusIcon, statusLabel } from "./status-format";

// Max visible processes in the list (scrollable if more)
const MAX_VISIBLE_PROCESSES = 8;
// Max log lines shown
const MAX_LOG_LINES = 12;

function formatRuntime(startTime: number, endTime: number | null): string {
  const end = endTime ?? Date.now();
  const ms = end - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

function truncate(str: string, maxLen: number): string {
  if (maxLen <= 3) return str.slice(0, maxLen);
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

export class ProcessesComponent implements Component {
  private tui: { requestRender: () => void };
  private theme: Theme;
  private onClose: () => void;
  private manager: ProcessManager;

  private selectedIndex = 0;
  private processScrollOffset = 0;
  private logScrollOffset = 0;
  private scrollInfo = { above: 0, below: 0 };
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    tui: { requestRender: () => void },
    theme: Theme,
    onClose: () => void,
    manager: ProcessManager,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.onClose = onClose;
    this.manager = manager;

    this.unsubscribe = this.manager.onEvent(() => {
      this.invalidate();
      this.tui.requestRender();
    });
  }

  handleInput(data: string): boolean {
    const processes = this.manager.list();

    // Navigation
    if (matchesKey(data, "down") || data === "j") {
      if (processes.length > 0) {
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          processes.length - 1,
        );
        this.logScrollOffset = 0;
        this.ensureProcessVisible(processes.length);
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    if (matchesKey(data, "up") || data === "k") {
      if (processes.length > 0) {
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.logScrollOffset = 0;
        this.ensureProcessVisible(processes.length);
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    // Scroll logs
    if (data === "J") {
      this.logScrollOffset = Math.max(0, this.logScrollOffset - 5);
      this.invalidate();
      this.tui.requestRender();
      return true;
    }

    if (data === "K") {
      this.logScrollOffset += 5;
      this.invalidate();
      this.tui.requestRender();
      return true;
    }

    // Kill selected process
    if (data === "x") {
      if (processes.length > 0 && this.selectedIndex < processes.length) {
        const proc = processes[this.selectedIndex];
        if (proc?.status === "running") {
          void this.manager.kill(proc.id, {
            signal: "SIGTERM",
            timeoutMs: 3000,
          });
        } else if (proc?.status === "terminate_timeout") {
          void this.manager.kill(proc.id, {
            signal: "SIGKILL",
            timeoutMs: 200,
          });
        }
      }
      return true;
    }

    // Clear finished processes
    if (data === "c" || data === "C") {
      const cleared = this.manager.clearFinished();
      if (cleared > 0) {
        const remaining = this.manager.list();
        if (this.selectedIndex >= remaining.length) {
          this.selectedIndex = Math.max(0, remaining.length - 1);
        }
        this.ensureProcessVisible(remaining.length);
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    // Close
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.onClose();
      return true;
    }

    return true;
  }

  private ensureProcessVisible(totalProcesses: number): void {
    const visibleCount = Math.min(MAX_VISIBLE_PROCESSES, totalProcesses);
    if (this.selectedIndex < this.processScrollOffset) {
      this.processScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.processScrollOffset + visibleCount) {
      this.processScrollOffset = this.selectedIndex - visibleCount + 1;
    }
    this.processScrollOffset = Math.max(
      0,
      Math.min(this.processScrollOffset, totalProcesses - visibleCount),
    );
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
    const warning = (s: string) => theme.fg("warning", s);
    const bold = (s: string) => theme.bold(s);
    const border = (s: string) => theme.fg("dim", s);

    const lines: string[] = [];
    const processes = this.manager.list();
    const innerWidth = width - 2;

    const padLine = (content: string): string => {
      const len = visibleWidth(content);
      return ` ${content}${" ".repeat(Math.max(0, innerWidth - len))} `;
    };

    const title = " Background Processes ";
    const titleLen = title.length;
    const borderLen = Math.max(0, width - titleLen);
    const leftBorder = Math.floor(borderLen / 2);
    const rightBorder = borderLen - leftBorder;
    lines.push(
      border("─".repeat(leftBorder)) +
        accent(bold(title)) +
        border("─".repeat(rightBorder)),
    );

    if (processes.length === 0) {
      lines.push(padLine(""));
      lines.push(padLine(dim("No background processes")));
      lines.push(padLine(dim("Use the processes tool to start commands")));
      lines.push(padLine(""));
    } else {
      const prefixWidth = 2;
      const idWidth = 9;
      const nameWidth = 15;
      const statusWidth = 18;
      const timeWidth = 8;
      const sizeWidth = 8;
      const cmdWidth = Math.max(
        20,
        innerWidth -
          prefixWidth -
          idWidth -
          nameWidth -
          statusWidth -
          timeWidth -
          sizeWidth,
      );

      const hasProcessScroll = processes.length > MAX_VISIBLE_PROCESSES;
      const headerSuffix = hasProcessScroll
        ? dim(
            ` [${this.processScrollOffset + 1}-${Math.min(this.processScrollOffset + MAX_VISIBLE_PROCESSES, processes.length)}/${processes.length}]`,
          )
        : "";

      lines.push(padLine(""));
      const header =
        "  " +
        dim("ID".padEnd(idWidth)) +
        dim("Name".padEnd(nameWidth)) +
        dim("Command".padEnd(cmdWidth)) +
        dim("Status".padEnd(statusWidth)) +
        dim("Time".padEnd(timeWidth)) +
        dim("Size".padStart(sizeWidth)) +
        headerSuffix;
      lines.push(padLine(header));
      lines.push(border("─".repeat(width)));

      const visibleProcessCount = Math.min(
        MAX_VISIBLE_PROCESSES,
        processes.length,
      );
      const startIdx = this.processScrollOffset;
      const endIdx = startIdx + visibleProcessCount;

      for (let i = startIdx; i < endIdx; i++) {
        const proc = processes[i];
        if (!proc) continue;
        const isSelected = i === this.selectedIndex;
        const sizes = this.manager.getFileSize(proc.id);
        const totalSize = sizes ? sizes.stdout + sizes.stderr : 0;

        const statusText = this.formatStatus(proc);
        const statusPadding =
          statusWidth + (statusText.length - visibleWidth(statusText));

        const row =
          (isSelected
            ? accent(proc.id.padEnd(idWidth))
            : proc.id.padEnd(idWidth)) +
          truncate(proc.name, nameWidth - 1).padEnd(nameWidth) +
          truncate(proc.command, cmdWidth - 1).padEnd(cmdWidth) +
          statusText.padEnd(statusPadding) +
          formatRuntime(proc.startTime, proc.endTime).padEnd(timeWidth) +
          formatBytes(totalSize).padStart(sizeWidth);

        if (isSelected) {
          lines.push(padLine(`${accent(">")} ${row}`));
        } else {
          lines.push(padLine(`  ${row}`));
        }
      }

      for (let i = visibleProcessCount; i < MAX_VISIBLE_PROCESSES; i++) {
        lines.push(padLine(""));
      }

      if (this.selectedIndex < processes.length) {
        const selected = processes[this.selectedIndex];
        if (!selected) {
          this.cachedLines = lines;
          this.cachedWidth = width;
          return this.cachedLines;
        }
        const output = this.manager.getOutput(selected.id, 200);
        const sizes = this.manager.getFileSize(selected.id);

        lines.push(border("─".repeat(width)));

        const logTitle = `Output: ${accent(selected.name)} ${dim(`(${selected.id})`)}`;
        const sizeInfo = sizes
          ? dim(
              ` stdout: ${formatBytes(sizes.stdout)}, stderr: ${formatBytes(sizes.stderr)}`,
            )
          : "";
        lines.push(padLine(logTitle + sizeInfo));
        lines.push(padLine(""));

        let renderedLines = 0;

        if (output) {
          const logLines: { type: "stdout" | "stderr"; text: string }[] = [];
          for (const line of output.stdout) {
            logLines.push({ type: "stdout", text: line });
          }
          for (const line of output.stderr) {
            logLines.push({ type: "stderr", text: line });
          }

          if (logLines.length === 0) {
            lines.push(padLine(dim("(no output yet)")));
            renderedLines = 1;
          } else {
            const startIdx = Math.max(
              0,
              logLines.length - MAX_LOG_LINES - this.logScrollOffset,
            );
            const endIdx = Math.max(0, logLines.length - this.logScrollOffset);
            const visibleLines = logLines.slice(startIdx, endIdx);

            this.scrollInfo.above = startIdx;
            this.scrollInfo.below =
              this.logScrollOffset > 0 ? logLines.length - endIdx : 0;

            for (const line of visibleLines) {
              const displayLine = truncate(line.text, innerWidth - 2);
              if (line.type === "stderr") {
                lines.push(padLine(warning(displayLine)));
              } else {
                lines.push(padLine(displayLine));
              }
              renderedLines++;
            }
          }
        }

        while (renderedLines < MAX_LOG_LINES) {
          lines.push(padLine(""));
          renderedLines++;
        }
      }
    }

    lines.push(border("─".repeat(width)));

    const footerLeft =
      `${dim("j/k")} select  ` +
      `${dim("x")} term/kill  ` +
      `${dim("c")} clear-finished  ` +
      `${dim("q")} quit`;

    let footerRight = "";
    if (this.scrollInfo.above > 0 || this.scrollInfo.below > 0) {
      const parts: string[] = [];
      if (this.scrollInfo.above > 0) {
        parts.push(`↑${this.scrollInfo.above}`);
      }
      if (this.scrollInfo.below > 0) {
        parts.push(`↓${this.scrollInfo.below}`);
      }
      footerRight = `${dim("J/K")} scroll ${dim(parts.join(" "))}`;
    }

    const footerLeftLen = visibleWidth(footerLeft);
    const footerRightLen = visibleWidth(footerRight);
    const footerGap = Math.max(2, innerWidth - footerLeftLen - footerRightLen);
    const footer = footerLeft + " ".repeat(footerGap) + footerRight;

    lines.push(padLine(footer));
    lines.push(border("─".repeat(width)));

    this.cachedLines = lines;
    this.cachedWidth = width;

    return this.cachedLines;
  }

  private formatStatus(proc: ProcessInfo): string {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const success = (s: string) => theme.fg("success", s);
    const warning = (s: string) => theme.fg("warning", s);
    const error = (s: string) => theme.fg("error", s);

    const icon = statusIcon(proc.status, proc.success);
    const label = statusLabel(proc);

    switch (proc.status) {
      case "running":
        return success(`${icon} ${label}`);
      case "terminating":
        return warning(`${icon} ${label}`);
      case "terminate_timeout":
        return error(`${icon} ${label}`);
      case "killed":
        return warning(`${icon} ${label}`);
      case "exited":
        return proc.success
          ? dim(`${icon} ${label}`)
          : error(`${icon} ${label}`);
      default:
        return dim(`${icon} ${label}`);
    }
  }
}
