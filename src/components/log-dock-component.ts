/**
 * Log Dock Component - shows process logs in the bottom dock.
 *
 * Collapsed view: one-line summary (running procs) + last log line.
 * Open view: LogFileViewer for the focused process (or first running), follow mode on.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { LIVE_STATUSES } from "../constants";
import type { ProcessManager } from "../manager";
import { formatRuntime, formatStatus, stripAnsi } from "../utils";
import { LogFileViewer } from "./log-file-viewer";

const PROCESS_COLORS: ThemeColor[] = [
  "accent",
  "warning",
  "success",
  "error",
  "accent",
  "dim",
  "accent",
  "warning",
];

const COLLAPSED_DOCK_RIGHT_MARGIN = 1;

function getCollapsedDockLineWidth(width: number): number {
  return Math.max(0, width - COLLAPSED_DOCK_RIGHT_MARGIN);
}

export function renderCollapsedDockLine(
  content: string,
  width: number,
): string {
  const lineWidth = getCollapsedDockLineWidth(width);
  if (lineWidth === 0) return "";

  return truncateToWidth(content, lineWidth, "", true);
}

interface LogDockOptions {
  manager: ProcessManager;
  theme: Theme;
  tui: { requestRender: () => void };
  mode: "collapsed" | "open";
  focusedProcessId: string | null;
  dockHeight?: number;
}

export class LogDockComponent implements Component {
  private manager: ProcessManager;
  private theme: Theme;
  private tui: { requestRender: () => void };
  private dockHeight: number;
  private mode: "collapsed" | "open";
  private focusedProcessId: string | null;

  private unsubscribeManager: (() => void) | null = null;

  /** One viewer per process, lazily created, follow:true. */
  private viewers: Map<string, LogFileViewer> = new Map();

  private processColors: Map<string, ThemeColor> = new Map();
  private colorCounter = 0;

  constructor(options: LogDockOptions) {
    this.manager = options.manager;
    this.theme = options.theme;
    this.tui = options.tui;
    this.dockHeight = options.dockHeight ?? 12;
    this.mode = options.mode;
    this.focusedProcessId = options.focusedProcessId;

    this.unsubscribeManager = this.manager.onEvent(() => {
      this.tui.requestRender();
    });
  }

  update(opts: {
    mode: "collapsed" | "open";
    focusedProcessId: string | null;
    dockHeight: number;
  }): void {
    this.mode = opts.mode;
    this.focusedProcessId = opts.focusedProcessId;
    this.dockHeight = opts.dockHeight;
    this.tui.requestRender();
  }

  handleInput(_data: string): boolean {
    return false;
  }

  invalidate(): void {
    // No local cache; always renders fresh.
  }

  private getProcessColor(processId: string): ThemeColor {
    const existing = this.processColors.get(processId);
    if (existing) return existing;
    const color = PROCESS_COLORS[this.colorCounter % PROCESS_COLORS.length];
    this.colorCounter++;
    this.processColors.set(processId, color);
    return color;
  }

  private getViewer(processId: string, combinedFile: string): LogFileViewer {
    let viewer = this.viewers.get(processId);
    if (!viewer) {
      viewer = new LogFileViewer({
        filePath: combinedFile,
        format: "combined",
        theme: this.theme,
        follow: true,
      });
      this.viewers.set(processId, viewer);
    }
    return viewer;
  }

  render(width: number): string[] {
    if (this.mode === "collapsed") return this.renderCollapsed(width);
    return this.renderOpen(width);
  }

  private renderCollapsed(width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const fg = (color: ThemeColor, s: string) => theme.fg(color, s);

    const processes = this.manager.list();
    const line = (content: string) => renderCollapsedDockLine(content, width);

    if (processes.length === 0) {
      return [
        line(` ${fg("accent", "Processes")}`),
        line(dim("  No processes")),
        "",
      ];
    }

    const running = processes.filter((p) => LIVE_STATUSES.has(p.status));
    const finished = processes.filter((p) => !LIVE_STATUSES.has(p.status));

    const headerBase = running.length
      ? `Processes · ${running.length} running`
      : finished.length
        ? `Processes · ${finished.length} finished`
        : "Processes";
    const headerSuffix =
      running.length && finished.length ? ` · ${finished.length} finished` : "";
    const lines = [line(` ${fg("accent", headerBase)}${dim(headerSuffix)}`)];

    for (const proc of running.slice(0, 4)) {
      const color = this.getProcessColor(proc.id);
      lines.push(
        line(
          `  ${fg(color, "●")} ${proc.name} ${dim(
            `· ${formatStatus(proc)} · ${formatRuntime(proc.startTime, proc.endTime)}`,
          )}`,
        ),
      );
    }

    if (running.length > 4) {
      lines.push(line(dim(`  +${running.length - 4} more`)));
    }

    if (running.length > 0) {
      const lastLogs = this.manager.getCombinedOutput(running[0].id, 1);
      if (lastLogs && lastLogs.length > 0) {
        const lastLog = stripAnsi(lastLogs[lastLogs.length - 1].text);
        lines.splice(2, 0, line(dim(`    ${lastLog}`)));
      }
    }

    return [...lines, ""];
  }

  private renderOpen(width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const fg = (color: ThemeColor, s: string) => theme.fg(color, s);

    const line = (content: string): string =>
      visibleWidth(content) > width
        ? truncateToWidth(content, width, "", true)
        : content;
    const contentWidth = Math.max(0, width - 1);

    const processes = this.manager.list();
    const running = processes.filter((p) => LIVE_STATUSES.has(p.status));

    const targetProc =
      (this.focusedProcessId
        ? processes.find((p) => p.id === this.focusedProcessId)
        : null) ??
      running[0] ??
      processes[0] ??
      null;

    if (!targetProc) {
      return [
        line(` ${fg("accent", "Process Logs")}`),
        line(dim("  No processes")),
        line(dim("  Run a command to start")),
      ];
    }

    const logFiles = this.manager.getLogFiles(targetProc.id);
    if (!logFiles) {
      return [
        line(` ${fg("accent", "Process Logs")}`),
        line(dim("  Log files unavailable")),
      ];
    }

    const viewer = this.getViewer(targetProc.id, logFiles.combinedFile);

    const logRows = Math.max(1, this.dockHeight - 1);

    const title = ` ${fg("accent", targetProc.name)} ${dim(
      `(${targetProc.id}) · ${formatStatus(targetProc)} · ${formatRuntime(
        targetProc.startTime,
        targetProc.endTime,
      )}`,
    )}`;
    const lines: string[] = [];
    lines.push(line(title));

    const contentLines = viewer.renderLines(contentWidth, logRows);
    for (let i = 0; i < logRows; i++) {
      lines.push(line(` ${contentLines[i] ?? ""}`));
    }

    return lines.slice(0, this.dockHeight);
  }

  dispose(): void {
    this.unsubscribeManager?.();
    this.viewers.clear();
    this.processColors.clear();
  }
}
