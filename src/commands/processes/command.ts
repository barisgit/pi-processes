import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { UtilsClient } from "pi-extension-utils";
import { ProcessesComponent } from "../../components/processes-component";
import type { DockActions } from "../../hooks/widget";
import type { ProcessManager } from "../../manager";

export function registerPsCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
  getUtilsClient: (ctx: ExtensionContext) => UtilsClient | undefined,
): void {
  pi.registerCommand("ps", {
    description: "View and manage background processes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const componentFactory = (
        tui: TUI,
        theme: Theme,
        done: (value: string | null) => void,
      ) => {
        return new ProcessesComponent(
          tui,
          theme,
          (processId?: string) => {
            if (processId) {
              dockActions.setFocus(processId);
            }
            done(processId ?? null);
          },
          manager,
        );
      };

      const client = getUtilsClient(ctx);
      if (client) {
        await client.ui.fullscreen<string | null>(
          (tui, theme, _keybindings, done) =>
            componentFactory(tui as TUI, theme as Theme, done),
        );
      } else {
        await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) =>
          componentFactory(tui, theme, done),
        );
      }
    },
  });
}
