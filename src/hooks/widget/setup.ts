import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { LogDockComponent } from "../../components/log-dock-component";
import { configLoader, type ResolvedProcessesConfig } from "../../config";
import { LIVE_STATUSES } from "../../constants";
import type { ProcessManager } from "../../manager";
import { renderStatusWidget } from "./status-widget";
import {
  type DockActions,
  type DockState,
  LOG_DOCK_WIDGET_ID,
  STATUS_WIDGET_ID,
} from "./types";

export function setupProcessWidget(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
) {
  let latestContext: ExtensionContext | null = null;
  let logDockComponent: LogDockComponent | null = null;
  let logDockComponentTui: { requestRender(): void } | null = null;

  const dockState: DockState = {
    visibility: "hidden",
    followEnabled: config.follow.enabledByDefault,
    focusedProcessId: null,
  };

  function updateWidget() {
    if (!latestContext?.hasUI) return;

    if (!configLoader.getConfig().widget.showStatusWidget) {
      latestContext.ui.setWidget(STATUS_WIDGET_ID, undefined);
    } else {
      const processes = manager.list();
      const maxWidth = process.stdout.columns || 120;
      const lines = renderStatusWidget(
        processes,
        latestContext.ui.theme,
        maxWidth,
      );

      if (lines.length === 0) {
        latestContext.ui.setWidget(STATUS_WIDGET_ID, undefined);
      } else {
        latestContext.ui.setWidget(STATUS_WIDGET_ID, lines, {
          placement: "belowEditor",
        });
      }
    }

    if (dockState.visibility === "hidden") {
      latestContext.ui.setWidget(LOG_DOCK_WIDGET_ID, undefined);
      if (logDockComponent) {
        logDockComponent.dispose();
        logDockComponent = null;
        logDockComponentTui = null;
      }
      return;
    }

    const mode = dockState.visibility as "collapsed" | "open";
    const height = mode === "collapsed" ? 3 : config.widget.dockHeight;

    if (logDockComponent && logDockComponentTui) {
      logDockComponent.update({
        mode,
        focusedProcessId: dockState.focusedProcessId,
        dockHeight: height,
      });
    } else {
      const ctx = latestContext;
      ctx.ui.setWidget(
        LOG_DOCK_WIDGET_ID,
        (tui: { requestRender(): void }, theme: typeof ctx.ui.theme) => {
          logDockComponent = new LogDockComponent({
            manager,
            tui,
            theme,
            mode,
            focusedProcessId: dockState.focusedProcessId,
            dockHeight: height,
          });
          logDockComponentTui = tui;
          return logDockComponent;
        },
        { placement: "aboveEditor" },
      );
    }
  }

  const dockActions: DockActions = {
    getFocusedProcessId: () => dockState.focusedProcessId,
    isFollowEnabled: () => dockState.followEnabled,
    setFocus(id) {
      dockState.focusedProcessId = id;
      if (id && dockState.visibility === "hidden")
        dockState.visibility = "open";
      updateWidget();
    },
    expand() {
      dockState.visibility = "open";
      updateWidget();
    },
    collapse() {
      dockState.visibility = "collapsed";
      updateWidget();
    },
    hide() {
      dockState.visibility = "hidden";
      updateWidget();
    },
    toggle() {
      if (dockState.visibility === "hidden") dockState.visibility = "collapsed";
      else if (dockState.visibility === "collapsed")
        dockState.visibility = "open";
      else dockState.visibility = "collapsed";
      updateWidget();
    },
    toggleFollow() {
      dockState.followEnabled = !dockState.followEnabled;
      updateWidget();
    },
  };

  manager.onEvent((event) => {
    if (event.type === "process_started") {
      if (dockState.followEnabled && dockState.visibility === "hidden") {
        dockState.visibility = "collapsed";
      }
    }

    if (event.type === "process_ended") {
      if (dockState.focusedProcessId === event.info.id) {
        dockState.focusedProcessId = null;
      }
      const running = manager.list().filter((p) => LIVE_STATUSES.has(p.status));
      if (
        running.length === 0 &&
        config.follow.autoHideOnFinish &&
        dockState.followEnabled
      ) {
        dockState.visibility = "hidden";
      }
    }

    updateWidget();
  });

  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
  });

  pi.on("session_switch", async (_event, ctx) => {
    if (logDockComponent) {
      logDockComponent.dispose();
      logDockComponent = null;
      logDockComponentTui = null;
    }
    latestContext = ctx;
    updateWidget();
  });

  return { update: updateWidget, dockActions };
}
