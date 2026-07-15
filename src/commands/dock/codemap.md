# src/commands/dock/

## Responsibility

Registers the `/ps:dock` command that controls process-dock visibility.

## Design

- `command.ts` is a thin command adapter over the `DockActions` interface; it owns argument normalization and dispatch but no dock state.
- `index.ts` is the folder's public barrel export for `registerPsDockCommand`.
- Completions advertise `show`, `hide`, and `toggle`. Empty or unrecognized input intentionally falls back to toggling.

## Data & Control Flow

1. `setupProcessesCommands` passes the extension API and shared `DockActions` implementation to `registerPsDockCommand`.
2. Registration adds `ps:dock` and its static argument completions to Pi.
3. The handler trims and lowercases its argument.
4. `show` calls `dockActions.expand()`, `hide` calls `dockActions.hide()`, and all other input calls `dockActions.toggle()`.

## Integration Points

- Uses `ExtensionAPI.registerCommand` from `@earendil-works/pi-coding-agent`.
- Depends on `DockActions` from `src/hooks/widget` for visibility mutations.
- Consumed by `src/commands/index.ts` during process-command setup.
