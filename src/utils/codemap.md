# src/utils/

## Responsibility

Provides focused, stateless support functions for process execution and lifecycle control, terminal-safe text handling, process display formatting, dock keybinding defaults, and shell-AST inspection.

## Design

- `command-executor.ts` resolves an existing absolute Bash executable, then spawns commands with inherited environment, piped stdio, and a detached process group.
- `process-group.ts` encapsulates POSIX negative-PID signaling for liveness checks and whole-group termination.
- `ansi.ts` removes CSI, OSC, APC, and unsafe C0 terminal controls while preserving tabs and newlines.
- `format.ts` converts process timing and status data into plain or theme-colored display strings.
- `keybindings.ts` defines the dock keybinding contract, defaults, and per-key nullish override merging.
- `shell-utils.ts` converts shell words to readable text and recursively visits every `SimpleCommand` in an `@aliou/sh` AST, with callback-directed early exit.
- `index.ts` is a selective barrel for ANSI, formatting, and process-group helpers; command execution, keybindings, and shell-AST helpers are imported directly.

## Data & Control Flow

1. `ProcessManager` passes command text, working directory, and configured shell to `spawnCommand`; shell resolution checks the configured path and known fallbacks before Node spawns the detached child.
2. Lifecycle operations call `isProcessGroupAlive` or `killProcessGroup`, translating a process ID into a process-group target by negating it.
3. Process metadata and log text flow through formatting and ANSI-sanitizing helpers before tools, hooks, and TUI components render them.
4. Configuration supplies optional key overrides, which `loadKeybindings` merges with `DEFAULT_KEYBINDINGS` into a complete binding set.
5. The background-command blocker parses shell input elsewhere, then uses `walkCommands` and `wordToString` to inspect nested commands and identify command names.

## Integration Points

- Depends on Node.js `child_process`, `fs`, `path`, and process signaling APIs.
- Uses `ProcessInfo` from `src/constants`, `Theme` from `@earendil-works/pi-coding-agent`, and shell AST types from `@aliou/sh`.
- Consumed by `src/manager.ts` for spawning and process-group management.
- Formatting and terminal sanitization are consumed by process tool actions, lifecycle hooks, and TUI components under `src/tools/`, `src/hooks/`, and `src/components/`.
- `src/config.ts` consumes keybinding defaults; `src/hooks/background-blocker.ts` consumes the shell-AST helpers.
