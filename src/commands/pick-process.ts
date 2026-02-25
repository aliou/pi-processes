import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ProcessPickerComponent } from "../components/process-picker-component";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";

export async function pickProcess(
  ctx: ExtensionCommandContext,
  manager: ProcessManager,
  title: string,
  filter?: (proc: ProcessInfo) => boolean,
): Promise<string | undefined> {
  if (!ctx.hasUI) {
    return undefined;
  }

  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    return new ProcessPickerComponent(
      tui,
      theme,
      (processId?: string) => {
        done(processId ?? null);
      },
      manager,
      title,
      filter,
    );
  });

  if (result === undefined || result === null) {
    return undefined;
  }

  return result;
}
