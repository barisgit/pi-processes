# `src/commands/clear/`

## Responsibility

Registers the `/ps:clear` slash command, which removes finished processes from the process manager while leaving live processes untouched.

## Design

- `command.ts` contains the registration function and keeps the command handler thin by delegating cleanup to `ProcessManager`.
- `index.ts` is the folder's public barrel, re-exporting `registerPsClearCommand`.
- The handler is asynchronous to match the command API, but cleanup itself is synchronous and its return count is intentionally ignored.

## Data & Control Flow

1. Extension setup calls `registerPsClearCommand(pi, manager)`.
2. The function registers `ps:clear` with the extension API.
3. When invoked, the handler calls `manager.clearFinished()`.
4. `ProcessManager` removes non-live process records and their output files, clears related state, emits a process-list change when needed, and stops its watcher when idle.

## Integration Points

- `@earendil-works/pi-coding-agent` supplies `ExtensionAPI` and the `registerCommand` interface.
- `../../manager` supplies the shared `ProcessManager` instance and owns all cleanup behavior.
- Parent command registration imports `registerPsClearCommand` through this folder's `index.ts`.
