# src/commands/

## Responsibility

Defines the `/ps` command surface for background-process management. The top-level files register the command suite, provide process ID/name completion factories, and expose a shared UI process picker used by individual commands.

## Design

- `index.ts` is the composition root: `setupProcessesCommands` delegates each command to its focused registrar under `clear/`, `dock/`, `kill/`, `logs/`, `pin/`, and `processes/`.
- `completions.ts` provides closures over `ProcessManager`; one factory includes every process and the other restricts results to running processes.
- `pick-process.ts` adapts `ProcessPickerComponent` to an async command helper and treats unavailable UI or picker cancellation as no selection.

## Data & Control Flow

1. Extension setup calls `setupProcessesCommands` with the Pi API, shared `ProcessManager`, dock actions, and utility-client resolver.
2. Each registrar installs its `/ps` command and receives only the dependencies it needs.
3. Completion callbacks read `manager.list()`, match a case-insensitive prefix against process IDs or names, and return command completion records keyed by process ID.
4. Commands needing interactive selection call `pickProcess`; it opens a custom TUI picker, optionally filters `ProcessInfo` entries, and resolves with the selected process ID or `undefined`.

## Integration Points

- Depends on `ProcessManager` for process state and lookup data.
- Uses Pi extension command/UI APIs from `@earendil-works/pi-coding-agent`.
- Coordinates dock state through `DockActions` from `src/hooks/widget.ts`.
- Uses `ProcessPickerComponent` from `src/components/` and `ProcessInfo` from `src/constants/`.
- Supplies `UtilsClient` access from `pi-extension-utils` to the main `/ps` command registrar.
