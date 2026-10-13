import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { UtilsClient } from "pi-extension-utils/pi";
import type { ResolvedProcessesConfig } from "../config.ts";
import type { ProcessManager } from "../manager.ts";
import { setupBackgroundBlocker } from "./background-blocker.ts";
import { setupCleanupHook } from "./cleanup.ts";
import { setupMessageRenderer } from "./message-renderer.ts";
import { setupProcessEndHook } from "./process-end.ts";
import { setupProcessWatchHook } from "./process-watch.ts";
import { type DockActions, setupProcessWidget } from "./widget/index.ts";

export type { DockActions };

export function setupProcessesHooks(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
): {
  update: () => void;
  dockActions: DockActions;
  getUtilsClient: (ctx: ExtensionContext) => UtilsClient | undefined;
} {
  setupCleanupHook(pi, manager);
  setupProcessEndHook(pi, manager);
  setupProcessWatchHook(pi, manager);

  if (config.interception.blockBackgroundCommands) {
    setupBackgroundBlocker(pi);
  }

  // Set up widget AFTER process-end so it chains onto the existing callback
  const widget = setupProcessWidget(pi, manager, config);

  setupMessageRenderer(pi);

  return widget;
}
