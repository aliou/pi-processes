import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { truncateToWidth } from "../../shared/truncate";

export interface OverviewPanelOptions {
  title?: string;
  headerLeft?: string;
  headerRight?: string;
  body: Component;
  footer?: Component;
  borderStyle?: (text: string) => string;
  titleStyle?: (text: string) => string;
  metaStyle?: (text: string) => string;
  padding?: number;
}

const BORDER = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  left: "│",
  right: "│",
  footSep: "├",
  footEnd: "┤",
  h: "─",
};

/**
 * Local vendored variant of @aliou/pi-utils-ui Panel for /ps.
 *
 * The upstream Panel only supports a centered title. The overview needs
 * left/center/right header slots. Keep this small and local so it can be
 * upstreamed later without changing the rest of the /ps component.
 */
export class OverviewPanel implements Component {
  private readonly title: string;
  private readonly headerLeft: string;
  private readonly headerRight: string;
  private readonly body: Component;
  private readonly footer?: Component;
  private readonly borderStyle: (text: string) => string;
  private readonly titleStyle: (text: string) => string;
  private readonly metaStyle: (text: string) => string;
  private readonly padding: number;

  constructor(options: OverviewPanelOptions) {
    this.title = options.title ?? "";
    this.headerLeft = options.headerLeft ?? "";
    this.headerRight = options.headerRight ?? "";
    this.body = options.body;
    this.footer = options.footer;
    this.borderStyle = options.borderStyle ?? ((text) => text);
    this.titleStyle = options.titleStyle ?? ((text) => text);
    this.metaStyle = options.metaStyle ?? ((text) => text);
    this.padding = options.padding ?? 1;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(0, width - 2);
    const contentWidth = Math.max(0, innerWidth - this.padding * 2);

    lines.push(this.renderHeader(innerWidth));

    for (let i = 0; i < this.padding; i++) {
      lines.push(this.borderLine(innerWidth));
    }

    for (const line of this.body.render(contentWidth)) {
      lines.push(this.contentLine(innerWidth, line));
    }

    for (let i = 0; i < this.padding; i++) {
      lines.push(this.borderLine(innerWidth));
    }

    if (this.footer) {
      lines.push(
        this.borderStyle(BORDER.footSep) +
          this.borderStyle(BORDER.h.repeat(innerWidth)) +
          this.borderStyle(BORDER.footEnd),
      );
      for (const line of this.footer.render(contentWidth)) {
        lines.push(this.contentLine(innerWidth, line));
      }
    }

    lines.push(
      this.borderStyle(BORDER.bl) +
        this.borderStyle(BORDER.h.repeat(innerWidth)) +
        this.borderStyle(BORDER.br),
    );

    return lines;
  }

  invalidate(): void {
    this.body.invalidate();
    this.footer?.invalidate();
  }

  private renderHeader(innerWidth: number): string {
    if (innerWidth <= 0) {
      return this.borderStyle(BORDER.tl) + this.borderStyle(BORDER.tr);
    }

    const leftRaw = this.headerLeft ? ` ${this.headerLeft} ` : "";
    const rightRaw = this.headerRight ? ` ${this.headerRight} ` : "";
    const centerRaw = this.title ? ` ${this.title} ` : "";

    const center = this.titleStyle(truncateToWidth(centerRaw, innerWidth, ""));
    const centerWidth = visibleWidth(center);
    const centerStart = Math.max(0, Math.floor((innerWidth - centerWidth) / 2));

    const leftBudget = centerStart;
    const left = this.metaStyle(truncateToWidth(leftRaw, leftBudget, ""));

    const centerEnd = centerStart + centerWidth;
    const rightBudget = Math.max(0, innerWidth - centerEnd);
    const right = this.metaStyle(truncateToWidth(rightRaw, rightBudget, ""));
    const rightWidth = visibleWidth(right);

    let output = "";
    let cursor = 0;
    const appendRuleTo = (target: number) => {
      if (target <= cursor) return;
      output += this.borderStyle(BORDER.h.repeat(target - cursor));
      cursor = target;
    };
    const appendSegment = (segment: string) => {
      output += segment;
      cursor += visibleWidth(segment);
    };

    appendSegment(left);
    appendRuleTo(centerStart);
    appendSegment(center);
    if (rightWidth > 0) {
      const rightStart = Math.max(0, innerWidth - rightWidth);
      if (rightStart >= cursor) {
        appendRuleTo(rightStart);
        appendSegment(right);
      }
    }
    appendRuleTo(innerWidth);

    return (
      this.borderStyle(BORDER.tl) +
      truncateToWidth(output, innerWidth, "", true) +
      this.borderStyle(BORDER.tr)
    );
  }

  private borderLine(innerWidth: number): string {
    return (
      this.borderStyle(BORDER.left) +
      " ".repeat(innerWidth) +
      this.borderStyle(BORDER.right)
    );
  }

  private contentLine(innerWidth: number, content: string): string {
    const padded =
      " ".repeat(this.padding) +
      truncateToWidth(
        content,
        Math.max(0, innerWidth - this.padding * 2),
        "",
        true,
      ) +
      " ".repeat(this.padding);
    const inner = truncateToWidth(padded, innerWidth, "", true);
    return (
      this.borderStyle(BORDER.left) + inner + this.borderStyle(BORDER.right)
    );
  }
}
