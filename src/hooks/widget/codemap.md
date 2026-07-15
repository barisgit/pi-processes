# `src/hooks/widget/`

## Responsibility

Owns the process-status and log-dock widgets displayed around Pi's editor. It formats process summaries, manages dock visibility and focus state, and binds widget lifecycle updates to process and session events.

## Design

- `setup.ts` is the stateful coordinator. `setupProcessWidget()` closes over the active extension context, lazily connected `pi-extension-utils` client, dock state, and current `LogDockComponent`.
- `status-widget.ts` is a pure renderer: it orders live processes before finished ones, applies theme styling, and fits the single-line summary to the terminal width.
- `types.ts` defines the dock state/action contract and stable widget IDs; `index.ts` exposes the setup function and public `DockActions` type.
- The log dock has three explicit states: `hidden`, `collapsed`, and `open`. The active component is reused for local state updates; if the shared widget host recreates it, the previous instance is disposed before replacement to release its manager listener.

## Data & Control Flow

1. `setupProcessWidget()` initializes dock state from resolved follow configuration and returns `update`, `dockActions`, and `getUtilsClient`.
2. Session start records the active UI context, resets prior widget resources, and calls `updateWidget()`; session shutdown removes widgets and disposes the client/component.
3. `updateWidget()` reads current configuration and `ProcessManager.list()`, renders or removes the status widget, then creates, updates, or removes the log dock according to dock state.
4. `DockActions` mutate focus or visibility and immediately trigger a widget update.
5. Manager events refresh both widgets. Starts can reveal a collapsed dock when follow mode is enabled; ends clear stale focus and can auto-hide the dock after the last live process finishes.

## Integration Points

- `ProcessManager` supplies process snapshots and lifecycle events.
- `configLoader` and `ResolvedProcessesConfig` control status visibility, dock height, follow defaults, and auto-hide behavior.
- `pi-extension-utils` registers/removes widgets through a lazily created `UtilsClient`.
- `LogDockComponent` renders the interactive log dock; Pi extension session hooks govern its lifetime.
- `@earendil-works/pi-tui` width helpers and the active Pi theme provide ANSI-aware status rendering.
