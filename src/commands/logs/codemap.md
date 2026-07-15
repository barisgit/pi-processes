# src/commands/logs/

## Responsibility

Registers the `ps:logs` slash command that opens the interactive process log viewer.

## Design

- `command.ts` owns command registration and adapts Pi's command/UI APIs to `LogOverlayComponent`.
- `index.ts` is the folder's public barrel export.
- The command remains stateless; process lookup and log-viewer state stay in `ProcessManager` and the overlay component.

## Data & Control Flow

1. `registerPsLogsCommand(pi, manager)` registers `ps:logs` with completions from `allProcessCompletions(manager)`.
2. The handler exits when UI support is unavailable.
3. An optional trimmed argument is resolved through `manager.get`; an unknown process stops the command, while a valid one supplies its canonical ID.
4. `ctx.ui.custom` creates `LogOverlayComponent` with the manager, optional initial process ID, theme/TUI handles, and a callback that closes the overlay.
5. Pi renders the component as a centered overlay at 90% width and up to 80% height.

## Integration Points

- **Pi extension API:** `ExtensionAPI.registerCommand` and the command context's `ui.custom` host the command and overlay.
- **Process state:** `ProcessManager` supplies completion candidates, argument lookup, and the manager instance consumed by the log viewer.
- **Command support:** `../completions` provides ID/name prefix completions for all managed processes.
- **TUI:** `../../components/log-overlay-component` implements process selection, log display, filtering, scrolling, and close behavior.
- **Consumers:** command registration code imports `registerPsLogsCommand` through `index.ts`.
