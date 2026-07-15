# src/tools/actions/

## Responsibility

Implements the `process` tool's action layer. Each module validates one action's parameters, delegates process lifecycle or I/O work to `ProcessManager`, and returns a shared `ExecuteResult`. The same folder also supplies TUI call/result renderers for action-specific presentation.

## Design

- `index.ts` is the dispatcher for execution (`executeAction`) and rendering (`renderActionCall`, `renderActionResult`).
- Action modules are thin adapters: `start`, `list`, `output`, `logs`, `kill`, `clear`, and `write` translate tool arguments and manager results into user-facing messages plus structured `ProcessesDetails`.
- Renderers use `ToolCallHeader`, `ToolBody`, `ToolFooter`, and `Text`; actions without specialized result views use the generic message renderer in `index.ts`.
- `output.ts` strips ANSI sequences and tail-truncates agent-visible output by configured line count and a 50 KB cap while retaining log-file paths.
- `debug.ts` provides side-effect-free mock results and is dispatched only when `PI_PROCESSES_DEBUG_PREVIEW=1`.

## Data & Control Flow

1. Tool parameters enter `executeAction`, which switches on `action` and calls the matching `execute*` function.
2. The action validates required fields and, for `start`, log-watch definitions; invalid input returns `success: false` without calling the manager.
3. Valid actions call `ProcessManager` to start, list, inspect, terminate, clear, or write to a process. `start` falls back to `ExtensionContext.cwd`; `output` also reads output limits from `configLoader`.
4. Each action returns text content for the agent and structured details for rendering. `renderActionCall` formats invocation arguments, while `renderActionResult` selects specialized start/list/output/logs views or a generic message body.

## Integration Points

- Consumed by the process tool registration layer through the exports in `index.ts`.
- Depends on `ProcessManager` for process state, lifecycle operations, stdin, output, and log paths.
- Shares action/result types from `src/constants`, output/status formatters from `src/utils`, and output limits from `src/config`.
- Integrates with Pi's extension context and result types, `@aliou/pi-utils-ui`, and `@earendil-works/pi-tui` for terminal rendering.
