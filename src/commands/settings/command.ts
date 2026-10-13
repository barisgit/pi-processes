import { registerSettingsCommand } from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProcessesConfig, ResolvedProcessesConfig } from "../../config.ts";
import { configLoader } from "../../config.ts";
import { applySettingChange } from "./apply-setting-change.ts";
import { buildSettingsSections } from "./build-sections.ts";

export function registerProcessesSettings(
  pi: ExtensionAPI,
  onSave?: () => void,
): void {
  registerSettingsCommand<ProcessesConfig, ResolvedProcessesConfig>(pi, {
    commandName: "ps:settings",
    title: "Processes Settings",
    configStore: configLoader,
    buildSections: buildSettingsSections,
    onSettingChange: applySettingChange,
    onSave,
  });
}
