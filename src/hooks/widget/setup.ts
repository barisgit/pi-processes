import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { connect, type UtilsClient } from "pi-extension-utils";
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
  let activeCtx: ExtensionContext | null = null;
  let widgetClient: UtilsClient | undefined;
  let logDockComponent: LogDockComponent | null = null;
  let logDockComponentTui: { requestRender(): void } | null = null;

  const getUtilsClient = (ctx: ExtensionContext): UtilsClient | undefined => {
    if (!ctx.hasUI) return undefined;
    widgetClient ??= connect(pi, { ctx, clientId: "pi-processes" });
    return widgetClient;
  };

  const removeWidgets = (): void => {
    widgetClient?.widgets.remove("belowEditor", STATUS_WIDGET_ID);
    widgetClient?.widgets.remove("aboveEditor", LOG_DOCK_WIDGET_ID);
  };

  const dockState: DockState = {
    visibility: "hidden",
    followEnabled: config.follow.enabledByDefault,
    focusedProcessId: null,
  };

  function updateWidget() {
    if (!activeCtx?.hasUI) return;
    const client = getUtilsClient(activeCtx);
    if (!client) return;

    if (!configLoader.getConfig().widget.showStatusWidget) {
      client.widgets.remove("belowEditor", STATUS_WIDGET_ID);
    } else {
      const processes = manager.list();
      const maxWidth = process.stdout.columns || 120;
      const lines = renderStatusWidget(processes, activeCtx.ui.theme, maxWidth);

      if (lines.length === 0) {
        client.widgets.remove("belowEditor", STATUS_WIDGET_ID);
      } else {
        client.widgets.set(
          "belowEditor",
          STATUS_WIDGET_ID,
          () => ({ render: () => lines, invalidate: () => {} }),
          { order: 10 },
        );
      }
    }

    if (dockState.visibility === "hidden") {
      client.widgets.remove("aboveEditor", LOG_DOCK_WIDGET_ID);
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
      client.widgets.set(
        "aboveEditor",
        LOG_DOCK_WIDGET_ID,
        (tui, theme) => {
          logDockComponent?.dispose();
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
        { order: 10 },
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
    removeWidgets();
    widgetClient?.dispose();
    widgetClient = undefined;
    if (logDockComponent) {
      logDockComponent.dispose();
      logDockComponent = null;
      logDockComponentTui = null;
    }
    activeCtx = ctx;
    updateWidget();
  });

  pi.on("session_shutdown", async () => {
    activeCtx = null;
    if (logDockComponent) {
      logDockComponent.dispose();
      logDockComponent = null;
      logDockComponentTui = null;
    }
    removeWidgets();
    widgetClient?.dispose();
    widgetClient = undefined;
  });

  return { update: updateWidget, dockActions, getUtilsClient };
}
