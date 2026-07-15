# `src/components/`

## Responsibility

Implements the terminal UI for inspecting and controlling managed background processes. The folder provides process lists and pickers, collapsed/open log docks, a tabbed log overlay, file-backed log navigation, and shared width-safe rendering/status helpers.

## Design

- `ProcessesComponent` configures a `pi-extension-utils` `paneOverlay`: the primary sidebar selects processes, the detail pane shows metadata plus a scrollable output tail, and a derived primary-pane legend documents navigation and custom actions. The overlay supports pane focus/resizing, `s` sidebar collapse, stream-to-dock, terminate/force-kill, and clear-finished actions.
- `ProcessPickerComponent` is a smaller filtered selection panel that returns a process ID through its close callback.
- `LogDockComponent` renders either a compact process summary or an always-following log view for the focused process.
- `LogOverlayComponent` is a stateful, tabbed overlay with normal, search-entry, and active-search modes. It keeps one lazily created `LogFileViewer` per process.
- `LogFileViewer` is a plain helper rather than a TUI `Component`. It reads a log file on demand, parses plain or manager-tagged combined lines, filters stdout/stderr, tracks follow/scroll position, and computes case-insensitive search matches.
- `panel-helpers.ts` and `render-helpers.ts` centralize ANSI-aware clipping, padding, borders, titled rules, path shortening, and scroll labels. `status-format.ts` provides the shared process status labels and icons.
- Components subscribe to `ProcessManager` events and request TUI renders. `ProcessesComponent` resolves current rows and details lazily through `paneOverlay`; `ProcessPickerComponent` caches rendered lines by width and invalidates that cache when state changes.

## Data & Control Flow

1. A caller constructs a component with a `ProcessManager`, theme, TUI render hook, and close/completion callback.
2. Components obtain current `ProcessInfo` records through `manager.list()`; manager events update local selection/tab state, invalidate cached output where applicable, and call `requestRender()`.
3. Keyboard input changes selection, pane focus/width, sidebar visibility, tab, stream filter, scroll/follow position, or search state. Process actions call `manager.kill()` or `manager.clearFinished()`; selection and close actions return through callbacks.
4. `ProcessesComponent` reads recent output through `getCombinedOutput()` with `getOutput()` as a fallback. `LogDockComponent` and `LogOverlayComponent` resolve `getLogFiles()` and delegate combined-file rendering to `LogFileViewer`.
5. `LogFileViewer` rereads the target file for each navigation/search/render operation, parses `1:` as stdout and `2:` as stderr, applies the active stream filter, selects the visible window, and emits themed, width-bounded lines plus status metadata.
6. Rendering helpers use `visibleWidth()` and `truncateToWidth()` so ANSI styling does not break panel geometry. Components return arrays of terminal lines to the Pi TUI.
7. Close/dispose paths unsubscribe manager listeners and clear retained viewers or callbacks as appropriate.

## Integration Points

- **Pi TUI:** Implements `Component` from `@earendil-works/pi-tui`; uses `TUI`, `Input`, visible-width measurement, and ANSI-aware truncation.
- **Pi coding agent theme:** Uses `Theme`/`ThemeColor` from `@earendil-works/pi-coding-agent` for semantic terminal colors.
- **Process management:** Depends on `../manager` for process state, lifecycle events, output/log locations, file sizes, kill operations, and clearing finished records.
- **Domain/config:** Uses `ProcessInfo`, `ProcessStatus`, and `LIVE_STATUSES` from `../constants`; `ProcessesComponent` reads process-list sizing defaults from `../config`.
- **Utilities:** Uses `pi-extension-utils` for the coordinated process `paneOverlay`, plus `../utils` for ANSI stripping and shared runtime/status formatting where applicable.
- **Consumers:** Higher-level commands and hooks construct these components to present process selection, process details, docked logs, and overlay logs.
