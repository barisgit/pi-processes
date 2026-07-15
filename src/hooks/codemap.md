# src/hooks/

## Responsibility

Connects `ProcessManager` lifecycle and watch events to Pi session behavior: conversation notifications, agent-turn triggering, custom TUI rendering, shutdown cleanup, optional background-command interception, and process-widget setup.

## Design

- `setupProcessesHooks` is the composition root and returns the widget's `update`, `dockActions`, and `getUtilsClient` interface to its caller.
- Small registration functions subscribe either to Pi events (`tool_call`, `session_shutdown`) or `ProcessManager.onEvent`.
- Process notifications share `MESSAGE_TYPE_PROCESS_UPDATE`; discriminated `details.kind` payloads select lifecycle versus watch rendering.
- `safeSendMessage` suppresses only stale-session proxy errors and rethrows all others.
- Repeating watches use a per-process/watch timestamp map to limit agent turns to one every five seconds while still displaying every match.

## Data & Control Flow

1. `setupProcessesHooks` installs cleanup, process-end, process-watch, optional background blocking, widget, and message-renderer hooks.
2. On `process_ended`, `setupProcessEndHook` derives status, runtime, and alert policy from `ProcessInfo`, then sends a displayable process-update message and conditionally triggers an agent turn.
3. On `process_watch_matched`, `setupProcessWatchHook` packages the matched line and watch metadata, applies repeat-watch cooldown logic, and sends the same custom message type. Process-end events clear that process's cooldown entries.
4. `setupMessageRenderer` converts lifecycle or watch details into themed `Text`; messages without details fall back to their text content.
5. On shutdown, the cleanup hook stops the watcher, kills managed processes, and releases manager state. When enabled, the background blocker parses Bash tool calls and rejects background syntax or commands, with a regex fallback for parse failures.

## Integration Points

- Pi extension API: `pi.on`, `pi.sendMessage`, and `pi.registerMessageRenderer`.
- `ProcessManager`: event source plus watcher, process-shutdown, and cleanup operations.
- `src/constants`: process-update message type and `ProcessInfo`.
- `src/utils` and `src/utils/shell-utils`: runtime formatting and shell AST traversal.
- `src/hooks/widget/`: widget setup and returned dock/update utilities.
- `@aliou/sh` parses intercepted Bash commands; `@earendil-works/pi-tui` renders custom messages.
