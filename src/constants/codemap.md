# src/constants/

## Responsibility

Defines the shared process-domain contracts used across the extension: supported tool actions, process lifecycle states, process metadata, manager events, log-watch configuration and matches, operation results, and tool response details. It also owns the custom message type used for process update notifications.

## Design

- `types.ts` is the source of truth for both runtime constants and TypeScript types.
- `index.ts` is the folder's public barrel, re-exporting types with `export type` and exposing only the runtime values consumers need.
- `ProcessStatus` is a closed lifecycle union; `LIVE_STATUSES` centralizes which states still represent a live process.
- `ManagerEvent`, `KillResult`, and `WriteResult` are discriminated unions so consumers can narrow event and outcome variants safely.
- `ProcessInfo` is the shared serializable process snapshot. `ProcessesDetails` and `ExecuteResult` define the structured result envelope returned by process tool actions.

## Data & Control Flow

1. Tool inputs select a `ProcessAction` and supply options such as `StartOptions` and `LogWatch` entries.
2. The process manager creates and updates `ProcessInfo` snapshots, using `ProcessStatus` and `LIVE_STATUSES` for lifecycle decisions.
3. Manager changes are emitted as `ManagerEvent` variants; output watch matches carry `LogWatchMatchEvent` data.
4. Tool action handlers translate manager operations into `ExecuteResult`, combining text content with `ProcessesDetails` for rendering and programmatic inspection.
5. Process-end and watch hooks publish updates under `MESSAGE_TYPE_PROCESS_UPDATE`, which the message renderer recognizes.

## Integration Points

- `src/manager.ts` implements the lifecycle, event, kill, write, and watch contracts.
- `src/tools/actions/` consumes action and result types to execute process tool requests.
- `src/hooks/` uses manager events and `MESSAGE_TYPE_PROCESS_UPDATE` to emit and render notifications.
- `src/components/` and process-related commands consume `ProcessInfo` and `LIVE_STATUSES` for filtering and display.
- Consumers import through `src/constants/index.ts`; `types.ts` remains the implementation module behind that boundary.
