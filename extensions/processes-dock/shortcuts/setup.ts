import type {
  EventBus,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { requestConfig, requestOpenLogs } from "../client";
import type { DockController } from "../widget/setup";
import { ProcessesShortcutsEditor } from "./editor";

export function setupProcessShortcuts(
  ctx: ExtensionContext,
  events: EventBus,
  getController: () => DockController | null,
): (() => void) | null {
  if (!ctx.hasUI) return null;
  if (ctx.ui.getEditorComponent()) return null;

  const focusKey = requestConfig(events).shortcuts.focusKey;

  ctx.ui.setEditorComponent(
    (tui, editorTheme, keybindings) =>
      new ProcessesShortcutsEditor(tui, editorTheme, keybindings, {
        events,
        focusKey,
        ui: ctx.ui,
        getController,
        openLogs: (processId) => requestOpenLogs(events, processId),
      }),
  );

  return () => {
    ctx.ui.setEditorComponent(undefined);
  };
}
