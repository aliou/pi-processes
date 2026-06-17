import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Container, Text } from "@earendil-works/pi-tui";
import { exec } from "node:child_process";

const WIDGET_KEY = "dev-pid-widget";
const POLL_MS = 2000;
const MAX_SHOWN_CHILDREN = 5;

export default function devPidWidgetExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWidget(WIDGET_KEY, (tui) => new PidWidget(tui), {
      placement: "belowEditor",
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  });
}

class HorizontalRule implements Component {
  render(width: number): string[] {
    return ["─".repeat(Math.max(0, width))];
  }

  invalidate(): void {}
}

class PidWidget extends Container {
  private readonly tui: TUI;
  private readonly pidLine: Text;
  private readonly childLine: Text;
  private readonly separator: HorizontalRule;
  private readonly interval: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(tui: TUI) {
    super();
    this.tui = tui;

    this.pidLine = new Text(`pid=${process.pid} ppid=${process.ppid}`, 0, 0);
    this.childLine = new Text("child_pids=", 0, 0);
    this.separator = new HorizontalRule();

    this.addChild(this.pidLine);
    this.addChild(this.childLine);
    this.addChild(this.separator);

    this.refresh();
    this.interval = setInterval(() => this.refresh(), POLL_MS);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.interval);
  }

  private refresh(): void {
    exec(`pgrep -P ${process.pid}`, (error, stdout) => {
      if (this.disposed) return;

      const pids = (stdout ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .sort((a, b) => Number(a) - Number(b));

      const shown = pids.slice(0, MAX_SHOWN_CHILDREN);
      let text = `child_pids=${shown.join(",")}`;

      if (pids.length > MAX_SHOWN_CHILDREN) {
        text += ` (and ${pids.length - MAX_SHOWN_CHILDREN} more)`;
      }

      this.childLine.setText(text);
      this.invalidate();
      this.tui.requestRender();
    });
  }
}
