# src/commands/settings/

## Responsibility

Defines and registers the `/ps:settings` command, presents editable process-extension settings, and converts selected UI values into partial `ProcessesConfig` updates.

## Design

- `command.ts` adapts the extension's config loader and settings callbacks to `@aliou/pi-utils-settings`.
- `build-sections.ts` declaratively groups settings into UI sections and resolves each displayed value from tab-local configuration first, then resolved defaults.
- `apply-setting-change.ts` uses copy-on-write updates via `structuredClone`; it maps known setting IDs to typed nested config fields and returns `null` for unknown or invalid numeric values.
- `index.ts` exposes only `registerProcessesSettings` as the folder's public API.

## Data & Control Flow

1. Extension setup calls `registerProcessesSettings(pi, onSave)`.
2. `registerSettingsCommand` registers `ps:settings` with `configLoader`, `buildSettingsSections`, and `applySettingChange`.
3. Opening the command passes current tab and resolved configuration to `buildSettingsSections`, which returns labels, descriptions, current values, and allowed choices.
4. A selection passes its ID and string value to `applySettingChange`; the function clones the config, parses the value, updates the matching field, and returns the new config for persistence.
5. After persistence, the optional `onSave` callback allows the caller to react to the saved configuration.

## Integration Points

- Depends on `@aliou/pi-utils-settings` for command registration and `SettingsSection` UI contracts.
- Depends on `../../config` for `ProcessesConfig`, `ResolvedProcessesConfig`, and the shared `configLoader`.
- Uses `ExtensionAPI` from `@earendil-works/pi-coding-agent` to register the slash command.
- Consumed through `registerProcessesSettings`, re-exported by `index.ts` and called by extension initialization.
