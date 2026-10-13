import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupProcessesCommands } from "./commands/index.ts";
import { registerProcessesSettings } from "./commands/settings/index.ts";
import { configLoader } from "./config.ts";
import { setupProcessesHooks } from "./hooks/index.ts";
import { bindSessionManager } from "./session-manager.ts";
import { setupProcessesTools } from "./tools/index.ts";

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
