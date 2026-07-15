# src/commands/processes/

## Responsibility

Registers the `/ps` command that opens the interactive background-process manager and exposes the registration function through the folder barrel.

## Design

- `command.ts` keeps command wiring separate from the process UI and process lifecycle logic.
- A local component factory adapts both supported UI hosts to `ProcessesComponent`.
- The optional `pi-extension-utils` client is preferred for fullscreen display; the extension context's custom UI is the fallback.
- `index.ts` is the public barrel for `registerPsCommand`.

## Data & Control Flow

1. `registerPsCommand` registers the `ps` handler with the Pi extension API.
2. The handler exits when the current context has no UI.
3. It creates `ProcessesComponent` with the TUI, theme, and shared `ProcessManager`.
4. The component runs through `UtilsClient.ui.fullscreen` when available, otherwise through `ctx.ui.custom`.
5. On completion, a selected process ID is passed to `dockActions.setFocus`; the UI callback then returns that ID, or `null` when no process was selected.

## Integration Points

- Called by `src/commands/index.ts` during command registration.
- Uses Pi's `ExtensionAPI`, `ExtensionContext`, and theme/UI command contracts.
- Instantiates `src/components/processes-component.ts` for rendering and process actions.
- Reads process state through `src/manager.ts` and updates dock focus through `src/hooks/widget.ts`.
- Optionally integrates with `pi-extension-utils` for fullscreen presentation.
