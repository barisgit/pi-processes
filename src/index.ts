import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupProcessesCommands } from "./commands";
import { registerProcessesSettings } from "./commands/settings";
import { configLoader } from "./config";
import { setupProcessesHooks } from "./hooks";
import { bindSessionManager } from "./session-manager";
import { setupProcessesTools } from "./tools";

export default async function (pi: ExtensionAPI) {
  if (process.platform === "win32") {
    pi.on("session_start", async (_event, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify("processes extension not available on Windows", "warning");
    });
    return;
  }

  await configLoader.load();
  const binding = bindSessionManager(
    pi,
    () => configLoader.getConfig().execution.shellPath,
  );
  const { manager } = binding;

  const config = configLoader.getConfig();

  const {
    update: updateWidget,
    dockActions,
    getUtilsClient,
  } = setupProcessesHooks(pi, manager, config);
  setupProcessesCommands(pi, manager, dockActions, getUtilsClient);
  setupProcessesTools(pi, manager);
  registerProcessesSettings(pi, () => {
    updateWidget();
  });
  binding.finishSetup();
}
