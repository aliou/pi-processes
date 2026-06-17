import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

const WIDGET_KEY = "dev-pid-widget";
const FALLBACK_MS = 10_000;
const MAX_SHOWN_CHILDREN = 5;
const CHANNEL_PROCESS_CHANGED = "processes:changed";

export default function devPidWidgetExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      const widget = new PidWidget(tui, theme, pi);

      // Refresh whenever a managed process starts/stops/clears
      const off = pi.events.on(CHANNEL_PROCESS_CHANGED, () => {
        // Small delay so the OS process table catches up
        setTimeout(() => widget.refresh(), 200);
      });

      widget.onDispose = () => {
        off();
      };

      return widget;
    }, { placement: "belowEditor" });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  });
}

class DimRule implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    return [this.theme.fg("dim", "─".repeat(Math.max(0, width)))];
  }

  invalidate(): void {}
}

class PidWidget extends Container {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly pi: ExtensionAPI;
  private readonly pidLine: Text;
  private readonly childLine: Text;
  private readonly separator: DimRule;
  private readonly fallbackInterval: ReturnType<typeof setInterval>;
  private disposed = false;

  /** Called by the extension to clean up event listeners. */
  onDispose?: () => void;

  constructor(tui: TUI, theme: Theme, pi: ExtensionAPI) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.pi = pi;

    const dim = (s: string) => theme.fg("dim", s);

    this.pidLine = new Text(dim(`pid=${process.pid} ppid=${process.ppid}`), 0, 0);
    this.childLine = new Text(dim("child_pids="), 0, 0);
    this.separator = new DimRule(theme);

    this.addChild(this.pidLine);
    this.addChild(this.childLine);
    this.addChild(this.separator);

    this.refresh();
    // Slow fallback to catch children not started via the process tool
    this.fallbackInterval = setInterval(() => this.refresh(), FALLBACK_MS);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.fallbackInterval);
    this.onDispose?.();
  }

  private dim(s: string): string {
    return this.theme.fg("dim", s);
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;

    const result = await this.pi.exec("pgrep", ["-P", String(process.pid)], {
      timeout: 2000,
    });

    if (this.disposed) return;

    const pids = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+$/.test(line))
      .sort((a, b) => Number(a) - Number(b));

    const shown = pids.slice(0, MAX_SHOWN_CHILDREN);
    let text = `child_pids=${shown.join(",")}`;

    if (pids.length > MAX_SHOWN_CHILDREN) {
      text += ` (and ${pids.length - MAX_SHOWN_CHILDREN} more)`;
    }

    this.childLine.setText(this.dim(text));
    this.invalidate();
    this.tui.requestRender();
  }
}
