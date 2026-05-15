import { type Component, Spacer } from "@earendil-works/pi-tui";

export class ToolLayout implements Component {
  private header: Component | null = null;
  private body: Component | null = null;
  private footer: Component | null = null;
  private spacing = true;

  setHeader(component: Component | null): this {
    this.header = component;
    return this;
  }

  setBody(component: Component | null): this {
    this.body = component;
    return this;
  }

  setFooter(component: Component | null): this {
    this.footer = component;
    return this;
  }

  withSectionSpacing(enabled?: boolean): this {
    this.spacing = Boolean(enabled);
    return this;
  }

  invalidate(): void {
    for (const component of this.sections()) {
      component.invalidate?.();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];

    for (const component of this.sections()) {
      lines.push(...component.render(width));
    }

    return lines;
  }

  private sections(): Component[] {
    const sections: Component[] = [];

    if (this.header) {
      sections.push(this.header);
    }

    if (this.spacing && this.header && this.body) {
      sections.push(new Spacer(1));
    }

    if (this.body) {
      sections.push(this.body);
    }

    if (this.spacing && (this.header || this.body) && this.footer) {
      sections.push(new Spacer(1));
    }

    if (this.footer) {
      sections.push(this.footer);
    }

    return sections;
  }
}
