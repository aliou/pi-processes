import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { ProcessInfo, ProcessManager } from "../manager";

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

// ANSI helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

class ProcessesComponent implements Component {
  private tui: { requestRender: () => void };
  private onClose: () => void;
  private manager: ProcessManager;

  private selectedIndex = 0;
  private logScrollOffset = 0;
  private scrollInfo = { above: 0, below: 0 };
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    tui: { requestRender: () => void },
    _theme: Theme,
    onClose: () => void,
    manager: ProcessManager,
  ) {
    this.tui = tui;
    this.onClose = onClose;
    this.manager = manager;

    this.refreshInterval = setInterval(() => {
      this.invalidate();
      this.tui.requestRender();
    }, 1000);
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
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    if (matchesKey(data, "up") || data === "k") {
      if (processes.length > 0) {
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.logScrollOffset = 0;
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
    if (data === "x" || data === "X") {
      if (processes.length > 0 && this.selectedIndex < processes.length) {
        const proc = processes[this.selectedIndex];
        if (proc.status === "running") {
          this.manager.kill(proc.id);
          this.invalidate();
          this.tui.requestRender();
        }
      }
      return true;
    }

    // Clear finished processes
    if (data === "c" || data === "C") {
      const cleared = this.manager.clearFinished();
      if (cleared > 0) {
        // Adjust selection if needed
        const remaining = this.manager.list();
        if (this.selectedIndex >= remaining.length) {
          this.selectedIndex = Math.max(0, remaining.length - 1);
        }
        this.invalidate();
        this.tui.requestRender();
      }
      return true;
    }

    // Close
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
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

    const lines: string[] = [];
    const processes = this.manager.list();

    // Full width panel
    // Border structure: " ╭───...───╮" where total = width
    // So inner content (between │ and │) = width - 4 (for " │ " on each side)
    const innerWidth = width - 4;

    // Helper to create a box line with content
    const boxLine = (content: string) => {
      const contentLen = visibleWidth(content);
      const padding = Math.max(0, innerWidth - contentLen);
      return `${dim(" \u2502")} ${content}${" ".repeat(padding)}${dim("\u2502")}`;
    };

    // Pad line to full width
    const padLine = (line: string) => {
      const visLen = visibleWidth(line);
      const padding = Math.max(0, width - visLen);
      return line + " ".repeat(padding);
    };

    // Top border with title: " ╭───── Title ─────╮"
    // Total = 1 (space) + 1 (╭) + dashes + title + dashes + 1 (╮) = width
    // So dashes total = width - 3 - titleLen
    const title = ` ${bold(cyan("Background Processes"))} `;
    const titleLen = visibleWidth(title);
    const dashesTotal = width - 3 - titleLen;
    const leftDashes = Math.floor(dashesTotal / 2);
    const rightDashes = dashesTotal - leftDashes;
    lines.push(
      padLine(
        dim(` \u256D${"─".repeat(leftDashes)}`) +
          title +
          dim(`${"─".repeat(rightDashes)}\u256E`),
      ),
    );

    if (processes.length === 0) {
      lines.push(padLine(boxLine("")));
      lines.push(padLine(boxLine(dim("No background processes"))));
      lines.push(
        padLine(boxLine(dim("Use the processes tool to start commands"))),
      );
      lines.push(padLine(boxLine("")));
    } else {
      // Calculate column widths (account for 2-char selection prefix)
      const prefixWidth = 2; // "> " or "  "
      const idWidth = 9;
      const nameWidth = 15;
      const statusWidth = 14;
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

      // Header (with prefix spacing to align with rows)
      lines.push(padLine(boxLine("")));
      const header =
        "  " + // Same prefix width as rows
        dim("ID".padEnd(idWidth)) +
        dim("Name".padEnd(nameWidth)) +
        dim("Command".padEnd(cmdWidth)) +
        dim("Status".padEnd(statusWidth)) +
        dim("Time".padEnd(timeWidth)) +
        dim("Size".padStart(sizeWidth));
      lines.push(padLine(boxLine(header)));
      lines.push(padLine(dim(` \u251C${"─".repeat(width - 3)}\u2524`)));

      // Process rows
      for (let i = 0; i < processes.length; i++) {
        const proc = processes[i];
        const isSelected = i === this.selectedIndex;
        const sizes = this.manager.getFileSize(proc.id);
        const totalSize = sizes ? sizes.stdout + sizes.stderr : 0;

        const statusText = this.formatStatus(proc);
        const statusPadding =
          statusWidth + (statusText.length - visibleWidth(statusText));

        const row =
          (isSelected
            ? cyan(proc.id.padEnd(idWidth))
            : proc.id.padEnd(idWidth)) +
          truncate(proc.name, nameWidth - 1).padEnd(nameWidth) +
          truncate(proc.command, cmdWidth - 1).padEnd(cmdWidth) +
          statusText.padEnd(statusPadding) +
          formatRuntime(proc.startTime, proc.endTime).padEnd(timeWidth) +
          formatBytes(totalSize).padStart(sizeWidth);

        if (isSelected) {
          lines.push(padLine(boxLine(`${cyan(">")} ${row}`)));
        } else {
          lines.push(padLine(boxLine(`  ${row}`)));
        }
      }

      // Output section for selected process
      if (this.selectedIndex < processes.length) {
        const selected = processes[this.selectedIndex];
        const output = this.manager.getOutput(selected.id, 200);
        const sizes = this.manager.getFileSize(selected.id);

        lines.push(padLine(dim(` \u251C${"─".repeat(width - 3)}\u2524`)));

        // Output header with size info
        const logTitle = `Output: ${cyan(selected.name)} ${dim(`(${selected.id})`)}`;
        const sizeInfo = sizes
          ? dim(
              ` stdout: ${formatBytes(sizes.stdout)}, stderr: ${formatBytes(sizes.stderr)}`,
            )
          : "";
        lines.push(padLine(boxLine(logTitle + sizeInfo)));
        lines.push(padLine(boxLine("")));

        const maxLogLines = 12;
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
            lines.push(padLine(boxLine(dim("(no output yet)"))));
            renderedLines = 1;
          } else {
            const startIdx = Math.max(
              0,
              logLines.length - maxLogLines - this.logScrollOffset,
            );
            const endIdx = Math.max(0, logLines.length - this.logScrollOffset);
            const visibleLines = logLines.slice(startIdx, endIdx);

            // Track scroll info for footer
            this.scrollInfo.above = startIdx;
            this.scrollInfo.below =
              this.logScrollOffset > 0 ? logLines.length - endIdx : 0;

            for (const line of visibleLines) {
              const displayLine = truncate(line.text, innerWidth - 2);
              if (line.type === "stderr") {
                lines.push(padLine(boxLine(yellow(displayLine))));
              } else {
                lines.push(padLine(boxLine(displayLine)));
              }
              renderedLines++;
            }
          }
        }

        // Pad to fixed height
        while (renderedLines < maxLogLines) {
          lines.push(padLine(boxLine("")));
          renderedLines++;
        }
      }
    }

    // Footer with all controls
    lines.push(padLine(dim(` \u251C${"─".repeat(width - 3)}\u2524`)));

    // Build footer with scroll info if applicable
    const footerLeft =
      `${dim("j/k")} select  ` +
      `${dim("x")} kill  ` +
      `${dim("c")} clear  ` +
      `${dim("q")} quit`;

    let footerRight = "";
    if (this.scrollInfo.above > 0 || this.scrollInfo.below > 0) {
      const parts: string[] = [];
      if (this.scrollInfo.above > 0) {
        parts.push(`\u2191${this.scrollInfo.above}`);
      }
      if (this.scrollInfo.below > 0) {
        parts.push(`\u2193${this.scrollInfo.below}`);
      }
      footerRight = `${dim("J/K")} scroll ${dim(parts.join(" "))}`;
    }

    const footerLeftLen = visibleWidth(footerLeft);
    const footerRightLen = visibleWidth(footerRight);
    const footerGap = Math.max(2, innerWidth - footerLeftLen - footerRightLen);
    const footer = footerLeft + " ".repeat(footerGap) + footerRight;

    lines.push(padLine(boxLine(footer)));

    // Bottom border
    lines.push(padLine(dim(` \u2570${"─".repeat(width - 3)}\u256F`)));

    this.cachedLines = lines;
    this.cachedWidth = width;

    return this.cachedLines;
  }

  private formatStatus(proc: ProcessInfo): string {
    const icon = this.getStatusIcon(proc.status, proc.success);

    switch (proc.status) {
      case "running":
        return green(`${icon} running`);
      case "exited":
        if (proc.success) {
          return dim(`${icon} exit(0)`);
        }
        return red(`${icon} exit(${proc.exitCode ?? "?"})`);
      case "killed":
        return yellow(`${icon} killed`);
      default:
        return proc.status;
    }
  }

  private getStatusIcon(
    status: ProcessInfo["status"],
    success: boolean | null,
  ): string {
    switch (status) {
      case "running":
        return "\u25CF"; // filled circle
      case "exited":
        return success ? "\u2713" : "\u2717"; // check or x
      case "killed":
        return "\u2717"; // x mark
      default:
        return "?";
    }
  }
}

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
) {
  // Defer registration to session_start so we can check if UI is available.
  // Commands are only useful in interactive mode.
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    pi.registerCommand("processes", {
      description: "View and manage background processes",
      handler: async (_args, ctx) => {
        await ctx.ui.custom((tui, theme, done) => {
          return new ProcessesComponent(
            tui,
            theme,
            () => done(undefined),
            manager,
          );
        });
      },
    });
  });
}
