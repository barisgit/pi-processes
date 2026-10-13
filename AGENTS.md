# pi-processes

Public Pi extension for managing background processes.

## Tool and command audience

The `process` tool and all `/ps:*` commands are for **LLM use only**, not for users directly. Users can monitor processes via `/ps:logs` and kill them via `/ps:list`, but they should never be the ones starting processes — that is the agent's job.

During UI tests that require processes to be running, either give the user a prompt to send to the agent (which will start the processes via the `process` tool), or use tmux to drive it programmatically. Never instruct the user to run shell commands manually.

## Stack

- TypeScript (strict mode), pnpm 10.26.1, Biome, Changesets

## Scripts

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm changeset`

## Debug flags

- `PI_PROCESSES_DEBUG_PREVIEW=1` enables the temporary `process` tool action `debug_preview` for local renderer/UI preview work.
- Keep this flag off in normal use and user-facing examples.

## Structure

- `src/index.ts` - entry, `src/manager.ts` - process manager, `src/config.ts` - config loader, `src/constants/` - types/constants, `src/commands/` - slash commands + settings, `src/tools/` - tool/actions, `src/hooks/` - event hooks, `src/components/` - TUI, `src/utils/` - helpers, `src/test/` - test scripts

## Design invariants

- Share one `ProcessManager` across tools, commands, hooks, and components. Finished records and logs remain available until clear or cleanup; classify live states with `LIVE_STATUSES`.
- Register the widget after process-end handling. Notifications share `MESSAGE_TYPE_PROCESS_UPDATE` and discriminate rendering with `details.kind`; suppress only stale-session proxy errors.
- Repeating watches display every match but trigger at most one agent turn per process/watch every five seconds; process end clears that cooldown. Alerts queue after the active run, never steer it.
- Dock visibility is `hidden`, `collapsed`, or `open`. Dispose the prior dock component when the widget host recreates it, and unsubscribe manager listeners when UI components close.
- Process commands resolve canonical IDs before changing dock focus. Unknown/cancelled selections do nothing; kill escalates `terminate_timeout` to SIGKILL and clears matching focus only after success. Unknown dock arguments toggle visibility.
- Settings changes clone configuration before mutation and reject unknown settings or invalid numeric values.
- Combined logs tag stdout as `1:` and stderr as `2:`. ANSI-aware width helpers preserve terminal geometry; tool output strips ANSI and tail-truncates to configured lines and 50 KB while retaining log paths.
- Debug preview stays side-effect-free and is available only with `PI_PROCESSES_DEBUG_PREVIEW=1`.
