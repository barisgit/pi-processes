/**
 * Process commands with /ps: prefix.
 *
 * /ps                         - View and manage all background processes
 * /ps:logs [id]               - Open log viewer overlay (search, scroll, stream filter)
 * /ps:pin [id]                - Pin the dock to a specific process
 * /ps:kill [id]               - Kill a running process
 * /ps:clear                   - Remove all finished processes from the list
 * /ps:dock [show|hide|toggle] - Control dock visibility
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { UtilsClient } from "pi-extension-utils/pi";
import type { DockActions } from "../hooks/widget/index.ts";
import type { ProcessManager } from "../manager.ts";
import { registerPsClearCommand } from "./clear/index.ts";
import { registerPsDockCommand } from "./dock/index.ts";
import { registerPsKillCommand } from "./kill/index.ts";
import { registerPsLogsCommand } from "./logs/index.ts";
import { registerPsPinCommand } from "./pin/index.ts";
import { registerPsCommand } from "./processes/index.ts";

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
  getUtilsClient: (ctx: ExtensionContext) => UtilsClient | undefined,
): void {
  registerPsCommand(pi, manager, dockActions, getUtilsClient);
  registerPsPinCommand(pi, manager, dockActions);
  registerPsLogsCommand(pi, manager);
  registerPsKillCommand(pi, manager, dockActions);
  registerPsClearCommand(pi, manager);
  registerPsDockCommand(pi, dockActions);
}
