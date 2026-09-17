import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProcessManager } from "../manager";

export function setupCleanupHook(pi: ExtensionAPI, manager: ProcessManager) {
  pi.on("session_shutdown", async (event) => {
    if (event.reason === "reload") return;
    await manager.cleanup();
  });
}
