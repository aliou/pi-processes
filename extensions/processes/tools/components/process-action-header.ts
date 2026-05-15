import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import type { ProcessesParamsType } from "../schema";
import { buildCommandField } from "../utils";
import { ProcessActionTitle } from "./process-action-title";

export class ProcessActionHeader extends Container {
  constructor(
    args: ProcessesParamsType,
    theme: Theme,
    options: { action: string; suffix?: string; expanded?: boolean },
  ) {
    super();

    this.addChild(
      new ProcessActionTitle(options.action, theme, options.suffix),
    );

    if (args.command) {
      if (options.expanded) {
        this.addChild(new Spacer(1));
      }

      this.addChild(
        buildCommandField(args.command, theme, {
          truncate: !options.expanded,
        }),
      );
    }
  }
}
