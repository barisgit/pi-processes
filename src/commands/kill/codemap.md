# src/commands/kill/

## Responsibility

Registers the `/ps:kill` command for terminating a live managed process and re-exports its registration function.

## Design

- `registerPsKillCommand` wires command behavior into the Pi extension API.
- The command supports an explicit process argument, automatic selection when exactly one process is live, and an interactive picker when several are live.
- Live-state validation uses the shared `LIVE_STATUSES` set. Processes already in `terminate_timeout` receive `SIGKILL`; other live processes receive `SIGTERM`.
- Successful termination clears dock focus when the killed process was focused.

## Data & Control Flow

1. Command arguments are trimmed and resolved through `ProcessManager.get`; invalid or non-live targets exit without action.
2. With no argument, `ProcessManager.list` is filtered to live processes. The handler exits for none, selects the sole match directly, or delegates selection to `pickProcess`.
3. The selected process is re-read, the signal and timeout are chosen, and `ProcessManager.kill` performs termination.
4. On a successful result, the handler clears matching dock focus through `DockActions`.

## Integration Points

- `@earendil-works/pi-coding-agent` `ExtensionAPI`: registers `ps:kill` and supplies handler context.
- `ProcessManager`: provides lookup, listing, and process termination.
- `runningProcessCompletions`: offers completions for running process identifiers.
- `pickProcess`: provides interactive process selection.
- `LIVE_STATUSES`: defines which process states are killable.
- `DockActions`: reads and clears focused-process state.
- `index.ts`: exposes `registerPsKillCommand` to the command registration layer.
