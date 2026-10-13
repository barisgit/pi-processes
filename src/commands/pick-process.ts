import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ProcessPickerComponent } from "../components/process-picker-component.ts";
import type { ProcessInfo } from "../constants/index.ts";
import type { ProcessManager } from "../manager.ts";

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
