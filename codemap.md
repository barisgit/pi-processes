# Repository Atlas: pi-processes

## Project Responsibility

`pi-processes` is a public Pi extension for starting, monitoring, inspecting, and terminating background commands without blocking the agent conversation. It combines a process lifecycle manager, an LLM-facing tool, slash commands, event hooks, and coordinated terminal UI widgets.

## System Entry Points

- `src/index.ts`: Initializes configuration and `ProcessManager`, then registers tools, commands, renderers, and hooks.
- `src/manager.ts`: Owns process state, spawning, logs, watch matching, notifications, and cleanup.
- `src/config.ts`: Loads and validates extension settings.
- `package.json`: Declares Pi extension metadata, scripts, dependencies, peer dependencies, and bundled runtime packages.
- `README.md`: User-facing installation, commands, controls, and runtime behavior.

## Repository Directory Map

| Directory | Responsibility | Detailed map |
|---|---|---|
| `src/` | Extension bootstrap, configuration, and stateful process lifecycle core. | [`src/codemap.md`](src/codemap.md) |
| `src/commands/` | `/ps` slash-command registration, completion, and shared process picker behavior. | [`src/commands/codemap.md`](src/commands/codemap.md) |
| `src/commands/clear/` | Clears finished process records. | [`src/commands/clear/codemap.md`](src/commands/clear/codemap.md) |
| `src/commands/dock/` | Controls process-dock visibility. | [`src/commands/dock/codemap.md`](src/commands/dock/codemap.md) |
| `src/commands/kill/` | Terminates a selected managed process. | [`src/commands/kill/codemap.md`](src/commands/kill/codemap.md) |
| `src/commands/logs/` | Opens and controls the interactive log viewer. | [`src/commands/logs/codemap.md`](src/commands/logs/codemap.md) |
| `src/commands/pin/` | Pins the dock to a selected process. | [`src/commands/pin/codemap.md`](src/commands/pin/codemap.md) |
| `src/commands/processes/` | Opens the interactive process manager panel. | [`src/commands/processes/codemap.md`](src/commands/processes/codemap.md) |
| `src/commands/settings/` | Presents and applies extension settings. | [`src/commands/settings/codemap.md`](src/commands/settings/codemap.md) |
| `src/components/` | Terminal components for process lists, docks, logs, and display helpers. | [`src/components/codemap.md`](src/components/codemap.md) |
| `src/constants/` | Shared process-domain types, actions, states, events, and response contracts. | [`src/constants/codemap.md`](src/constants/codemap.md) |
| `src/hooks/` | Bridges process events into Pi sessions, messages, turns, UI, and cleanup. | [`src/hooks/codemap.md`](src/hooks/codemap.md) |
| `src/hooks/widget/` | Coordinates process status and log-dock widgets around Pi's editor. | [`src/hooks/widget/codemap.md`](src/hooks/widget/codemap.md) |
| `src/tools/` | Registers and renders the LLM-facing `process` tool. | [`src/tools/codemap.md`](src/tools/codemap.md) |
| `src/tools/actions/` | Implements individual process tool operations and action-specific renderers. | [`src/tools/actions/codemap.md`](src/tools/actions/codemap.md) |
| `src/utils/` | Stateless process execution, shell analysis, formatting, and terminal helpers. | [`src/utils/codemap.md`](src/utils/codemap.md) |
