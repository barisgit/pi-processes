# `src/`

## Responsibility

Hosts the extension entry point, configuration schema/defaults, and the process lifecycle manager. Together these modules initialize pi-processes and provide the stateful core used by commands, tools, hooks, and TUI components.

## Design

- `index.ts` is the composition root: it loads configuration, constructs one `ProcessManager`, and wires hooks, commands, tools, and settings around that shared instance. Windows exits early with a UI warning because process-group management is unsupported.
- `config.ts` defines optional user configuration and its fully resolved form. A `ConfigLoader` merges global and in-memory settings with `DEFAULT_CONFIG`; keybinding defaults are shared with `utils/keybindings`.
- `manager.ts` owns an in-memory map of child processes plus per-run temporary log files. It exposes immutable `ProcessInfo` snapshots, emits typed lifecycle/output/watch events, throttles output-change notifications, and uses an idle-aware polling timer to reconcile process-group liveness.

## Data & Control Flow

1. Pi calls the default export in `index.ts`; configuration is loaded before `ProcessManager` is created, and the configured shell path is supplied lazily.
2. Setup functions register the extension surfaces against the manager. Hooks receive resolved configuration and return dock/widget helpers consumed by commands and settings.
3. `ProcessManager.start()` validates log watches, creates stdout/stderr/combined logs, spawns a detached command, records runtime state, and subscribes to child output and termination events.
4. Output chunks are appended to files, split into complete lines, tagged in the combined log, checked against regex watches, and surfaced through throttled manager events. Consumers query process snapshots, tailed/full output, file paths, and file sizes.
5. Kill, stdin-write, liveness polling, child close/error, clearing, and cleanup operations update process state and emit lifecycle events. Finished processes retain metadata and logs until explicitly cleared or the manager is cleaned up.

## Integration Points

- Pi extension API: `index.ts` registers session handling, hooks, slash commands, settings, and the `process` tool through `commands/`, `hooks/`, and `tools/`.
- `@aliou/pi-utils-settings`: supplies `ConfigLoader` for global and ephemeral configuration scopes.
- `constants/`: supplies process state, event, watch, start, kill, and write contracts plus the live-status set.
- `utils/command-executor`: resolves/spawns shell commands; `utils/` provides process-group liveness and termination helpers.
- `commands/`, `tools/`, `hooks/`, and UI components consume the shared `ProcessManager` API and its event stream.
- Node.js child-process, filesystem, stream, event, OS, and path APIs provide execution, temporary log persistence, stdin, and notifications.
