# `src/commands/pin/`

## Responsibility

Registers the `/ps:pin` command, which pins the process dock to a selected running or retained process.

## Design

- `command.ts` owns command registration and argument handling.
- `index.ts` provides the folder's public export.
- Existing shared helpers supply process completions and the interactive process picker; dock state changes remain behind `DockActions`.

## Data & Control Flow

1. `registerPsPinCommand` registers `ps:pin` with the Pi extension API.
2. With an argument, the handler resolves it through `ProcessManager.get`; an unknown process ends the command without changing focus.
3. Without an argument, the handler opens `pickProcess` and stops if selection is cancelled.
4. The resolved process ID is passed to `dockActions.setFocus`, pinning the dock to that process.

## Integration Points

- `ExtensionAPI` registers the command and provides its handler context.
- `ProcessManager` resolves process arguments and feeds `allProcessCompletions`.
- `pickProcess` provides interactive selection when no argument is supplied.
- `DockActions.setFocus` applies the pinned dock focus.
