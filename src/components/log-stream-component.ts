import {
  createPanelPadder,
  renderPanelRule,
  renderPanelTitleLine,
} from "@aliou/pi-utils-ui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import type { ProcessManager } from "../manager";
import { stripAnsi } from "../utils";
import { statusIcon, statusLabel } from "./status-format";

const MAX_LOG_LINES = 16;
const POLL_INTERVAL_MS = 500;

export class LogStreamComponent implements Component {
  private tui: { requestRender: () => void };
  private theme: Theme;
  private manager: ProcessManager;
  private processId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private cachedLines: string[] = [];
  private cachedWidth = 0;

  constructor(
    tui: { requestRender: () => void },
    theme: Theme,
    manager: ProcessManager,
    processId: string,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.manager = manager;
    this.processId = processId;

    // Poll log file for new output.
    this.timer = setInterval(() => {
      this.invalidate();
      this.tui.requestRender();
    }, POLL_INTERVAL_MS);

    // Also re-render on process events (status changes, etc.).
    this.unsubscribe = this.manager.onEvent(() => {
      this.invalidate();
      this.tui.requestRender();
    });
  }

  handleInput(_data: string): boolean {
    // Widget doesn't handle input — the editor is still active.
    return false;
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
    const warning = (s: string) => theme.fg("warning", s);
    const innerWidth = width - 2;

    const basePadLine = createPanelPadder(width);
    const padLine = (content: string): string => {
      const contentWidth = visibleWidth(content);
      return basePadLine(
        contentWidth > innerWidth
          ? truncateToWidth(content, innerWidth)
          : content,
      );
    };

    const lines: string[] = [];
    const proc = this.manager.get(this.processId);

    if (!proc) {
      lines.push(renderPanelRule(width, theme));
      lines.push(padLine(warning("Process not found")));
      lines.push(renderPanelRule(width, theme));
      this.cachedLines = lines;
      this.cachedWidth = width;
      return this.cachedLines;
    }

    // Header
    const icon = statusIcon(proc.status, proc.success);
    const label = statusLabel(proc);
    lines.push(
      renderPanelTitleLine(
        `Process: ${proc.name} (${proc.id}) ${icon} ${label}`,
        width,
        theme,
      ),
    );

    // Log lines (interleaved stdout + stderr in temporal order).
    const logLines = this.manager.getCombinedOutput(
      this.processId,
      MAX_LOG_LINES,
    );
    if (logLines && logLines.length > 0) {
      for (const line of logLines) {
        const cleaned = stripAnsi(line.text);
        const display = truncateToWidth(cleaned, innerWidth - 2);
        if (line.type === "stderr") {
          lines.push(padLine(warning(display)));
        } else {
          lines.push(padLine(display));
        }
      }
    } else {
      lines.push(padLine(dim("(no output yet)")));
    }

    // Pad to MAX_LOG_LINES for stable height.
    const renderedLogLines = lines.length - 1; // minus header
    for (let i = renderedLogLines; i < MAX_LOG_LINES; i++) {
      lines.push(padLine(""));
    }

    // Footer hint
    lines.push(renderPanelRule(width, theme));
    lines.push(padLine(dim("Run /process:stream to dismiss")));
    lines.push(renderPanelRule(width, theme));

    this.cachedLines = lines;
    this.cachedWidth = width;
    return this.cachedLines;
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
