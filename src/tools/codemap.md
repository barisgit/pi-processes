# src/tools/

## Responsibility

Registers the LLM-facing `process` tool, defines its typed parameter contract, and connects tool execution to process actions and TUI rendering.

## Design

- `setupProcessesTools` is the folder's public entry point and registers one tool with Pi's `ExtensionAPI`.
- A TypeBox schema defines the action discriminator and optional action-specific fields; `Static` derives the renderer's TypeScript parameter type from that schema.
- Supported actions are centralized in `PROCESS_ACTIONS`. The side-effect-free `debug_preview` action is included only when `PI_PROCESSES_DEBUG_PREVIEW=1` at module load.
- Execution and action-specific presentation are delegated to `./actions`; this module owns registration, shared partial/error rendering, and the tool's prompt-facing metadata.

## Data & Control Flow

1. Extension startup calls `setupProcessesTools(pi, manager)`.
2. Pi validates an LLM tool call against `ProcessesParams` and invokes `execute`.
3. `execute` forwards the parameters, `ProcessManager`, and tool context to `executeAction`.
4. Pi passes call and result state to `renderCall` and `renderResult`; action renderers produce normal output, while this module handles partial state, thrown-tool results without details, and unsuccessful action details.

## Integration Points

- **Consumer:** `src/index.ts` calls `setupProcessesTools` during extension initialization.
- **Process lifecycle:** `../manager` supplies the `ProcessManager` used by action execution.
- **Action layer:** `./actions` provides execution plus call/result render dispatch.
- **Shared result contract:** `../constants` supplies `ProcessesDetails`.
- **Pi and UI APIs:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `@aliou/pi-utils-ui` provide registration, result types, and TUI components; `@earendil-works/pi-ai` and `typebox` define the runtime parameter schema.
