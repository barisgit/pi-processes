import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { configLoader } from "../config";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { stripAnsi } from "../utils";
import {
  flatRule,
  formatPath,
  formatScrollInfo,
  padRight,
  titledBottomSegment,
  titledTopSegment,
} from "./render-helpers";
import { statusIcon, statusLabel } from "./status-format";

const MIN_LEFT_PANE = 30;
const MIN_RIGHT_PANE = 36;
const LEFT_PANE_CAP = 72;
const DEFAULT_LEFT_FRACTION = 0.38;
const MIN_BODY_HEIGHT = 18;
const CHROME_ROWS = 2;
const DETAIL_HEADER_ROWS = 9;

function computeBodyHeight(): number {
  const rows = process.stdout.rows ?? 32;
  return Math.max(MIN_BODY_HEIGHT, rows - CHROME_ROWS);
}

function formatRuntime(startTime: number, endTime: number | null): string {
  const end = endTime ?? Date.now();
  const ms = end - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

function formatDateTime(ts: number | null): string {
  if (!ts) return "-";
  const date = new Date(ts);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function fitCell(
  value: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const clipped = truncateToWidth(value, Math.max(0, width), "");
  const pad = Math.max(0, width - visibleWidth(clipped));
  if (align === "right") return " ".repeat(pad) + clipped;
  return clipped + " ".repeat(pad);
}

type PaneFocus = "list" | "log";

export class ProcessesComponent implements Component {
  private tui: { requestRender: () => void };
  private theme: Theme;
  private onClose: (processId?: string) => void;
  private manager: ProcessManager;

  private selectedIndex = 0;
  private processScrollOffset = 0;
  private logScrollOffset = 0;
  private scrollInfo = { above: 0, below: 0 };
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private unsubscribe: (() => void) | null = null;
  private focus: PaneFocus = "list";
  private lastListHeight =
    configLoader.getConfig().processList.maxVisibleProcesses;
  private lastLogHeight = configLoader.getConfig().processList.maxPreviewLines;
  private splitFraction = DEFAULT_LEFT_FRACTION;

  constructor(
    tui: { requestRender: () => void },
    theme: Theme,
    onClose: (processId?: string) => void,
    manager: ProcessManager,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.onClose = onClose;
    this.manager = manager;

    this.unsubscribe = this.manager.onEvent(() => {
      this.invalidate();
      this.tui.requestRender();
    });
  }

  handleInput(data: string): boolean {
    const processes = this.manager.list();

    if (matchesKey(data, "tab")) {
      this.focus = this.focus === "list" ? "log" : "list";
      this.invalidateAndRender();
      return true;
    }

    if (matchesKey(data, "down") || data === "j") {
      if (this.focus === "log") this.scrollLog(-1);
      else this.moveSelection(processes, 1);
      return true;
    }

    if (matchesKey(data, "up") || data === "k") {
      if (this.focus === "log") this.scrollLog(1);
      else this.moveSelection(processes, -1);
      return true;
    }

    if (matchesKey(data, "pageDown")) {
      if (this.focus === "list")
        this.moveSelection(processes, this.lastListHeight);
      else this.scrollLog(-this.lastLogHeight);
      return true;
    }

    if (matchesKey(data, "pageUp")) {
      if (this.focus === "list")
        this.moveSelection(processes, -this.lastListHeight);
      else this.scrollLog(this.lastLogHeight);
      return true;
    }

    if (data === "g" || matchesKey(data, "home")) {
      if (this.focus === "list") this.jumpSelection(processes, false);
      else this.jumpLog(false);
      return true;
    }

    if (data === "G" || matchesKey(data, "end")) {
      if (this.focus === "list") this.jumpSelection(processes, true);
      else this.jumpLog(true);
      return true;
    }

    // Legacy explicit log scroll bindings remain available regardless of focus.
    if (data === "J" || matchesKey(data, "shift+down")) {
      this.scrollLog(-this.lastLogHeight);
      return true;
    }

    if (data === "K" || matchesKey(data, "shift+up")) {
      this.scrollLog(this.lastLogHeight);
      return true;
    }

    // Stream logs for selected process
    if (matchesKey(data, "return")) {
      if (processes.length > 0 && this.selectedIndex < processes.length) {
        const proc = processes[this.selectedIndex];
        if (proc) {
          this.unsubscribe?.();
          this.unsubscribe = null;
          this.onClose(proc.id);
        }
      }
      return true;
    }

    // Kill selected process
    if (data === "x") {
      if (processes.length > 0 && this.selectedIndex < processes.length) {
        const proc = processes[this.selectedIndex];
        if (proc?.status === "running") {
          void this.manager.kill(proc.id, {
            signal: "SIGTERM",
            timeoutMs: 3000,
          });
        } else if (proc?.status === "terminate_timeout") {
          void this.manager.kill(proc.id, {
            signal: "SIGKILL",
            timeoutMs: 200,
          });
        }
      }
      return true;
    }

    // Clear finished processes
    if (data === "c" || data === "C") {
      const cleared = this.manager.clearFinished();
      if (cleared > 0) {
        const remaining = this.manager.list();
        if (this.selectedIndex >= remaining.length) {
          this.selectedIndex = Math.max(0, remaining.length - 1);
        }
        this.ensureProcessVisible(remaining.length);
        this.invalidateAndRender();
      }
      return true;
    }

    // Close
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.onClose();
      return true;
    }

    return true;
  }

  private moveSelection(processes: ProcessInfo[], delta: number): void {
    if (processes.length === 0) return;
    this.selectedIndex = Math.max(
      0,
      Math.min(processes.length - 1, this.selectedIndex + delta),
    );
    this.logScrollOffset = 0;
    this.ensureProcessVisible(processes.length);
    this.invalidateAndRender();
  }

  private jumpSelection(processes: ProcessInfo[], toEnd: boolean): void {
    if (processes.length === 0) return;
    this.selectedIndex = toEnd ? processes.length - 1 : 0;
    this.logScrollOffset = 0;
    this.ensureProcessVisible(processes.length);
    this.invalidateAndRender();
  }

  private scrollLog(delta: number): void {
    const maxOffset = this.maxLogScrollOffset();
    this.logScrollOffset = Math.max(
      0,
      Math.min(maxOffset, this.logScrollOffset + delta),
    );
    this.invalidateAndRender();
  }

  private jumpLog(toEnd: boolean): void {
    this.logScrollOffset = toEnd ? 0 : this.maxLogScrollOffset();
    this.invalidateAndRender();
  }

  private maxLogScrollOffset(): number {
    const selected = this.selectedProcess();
    if (!selected) return 0;
    const lines = this.getLogLines(selected, this.logTailLimit());
    return Math.max(0, lines.length - this.lastLogHeight);
  }

  private logTailLimit(): number {
    const cfg = configLoader.getConfig().processList;
    return Math.max(cfg.maxPreviewLines * 4, this.lastLogHeight * 4, 100);
  }

  private selectedProcess(): ProcessInfo | undefined {
    const processes = this.manager.list();
    return processes[this.selectedIndex];
  }

  private ensureProcessVisible(totalProcesses: number): void {
    const visibleCount = Math.min(this.lastListHeight, totalProcesses);
    if (this.selectedIndex < this.processScrollOffset) {
      this.processScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.processScrollOffset + visibleCount) {
      this.processScrollOffset = this.selectedIndex - visibleCount + 1;
    }
    this.processScrollOffset = Math.max(
      0,
      Math.min(this.processScrollOffset, totalProcesses - visibleCount),
    );
  }

  invalidate(): void {
    this.cachedWidth = 0;
    this.cachedLines = [];
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedLines.length > 0) {
      return this.cachedLines;
    }

    const w = Math.max(8, width);
    const leftWidth = this.computeLeftWidth(w);
    const rightWidth = Math.max(1, w - 3 - leftWidth);
    const bodyHeight = computeBodyHeight();

    const processes = this.manager.list();
    if (this.selectedIndex >= processes.length) {
      this.selectedIndex = Math.max(0, processes.length - 1);
    }

    this.lastLogHeight = Math.max(1, bodyHeight - DETAIL_HEADER_ROWS - 1);

    const selected = processes[this.selectedIndex];
    const rightLines = selected
      ? this.buildRightPane(selected, rightWidth)
      : [this.theme.fg("dim", "No background processes")];

    const listHeight = bodyHeight;
    this.lastListHeight = listHeight;
    this.ensureProcessVisible(processes.length);
    const visibleProcesses = processes.slice(
      this.processScrollOffset,
      this.processScrollOffset + listHeight,
    );
    const leftLines =
      processes.length === 0
        ? [
            this.theme.fg("dim", "No background processes"),
            this.theme.fg("dim", "Use the processes tool to start commands"),
          ]
        : visibleProcesses.map((proc, index) =>
            this.renderProcessRow(
              proc,
              this.processScrollOffset + index === this.selectedIndex,
              leftWidth,
            ),
          );

    const visibleRight = rightLines.slice(0, bodyHeight);

    const rows: string[] = [
      this.topBorder(leftWidth, rightWidth, processes, selected),
    ];
    for (let i = 0; i < bodyHeight; i++) {
      rows.push(
        this.bodyRow(
          leftLines[i] ?? "",
          visibleRight[i] ?? "",
          leftWidth,
          rightWidth,
        ),
      );
    }
    rows.push(this.bottomBorder(leftWidth, rightWidth, processes.length));

    this.cachedLines = rows;
    this.cachedWidth = width;
    return this.cachedLines;
  }

  private computeLeftWidth(totalWidth: number): number {
    const interiorWidth = Math.max(0, totalWidth - 3);
    if (interiorWidth <= 0) return 0;
    const raw = Math.round(interiorWidth * this.splitFraction);
    const capped = Math.min(
      LEFT_PANE_CAP,
      Math.max(0, interiorWidth - MIN_RIGHT_PANE),
    );
    const maxLeft = capped > 0 ? capped : interiorWidth;
    const minLeft = Math.min(MIN_LEFT_PANE, maxLeft);
    return Math.max(minLeft, Math.min(maxLeft, raw));
  }

  private renderProcessRow(
    proc: ProcessInfo,
    selected: boolean,
    width: number,
  ): string {
    if (width <= 0) return "";
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const accent = (s: string) => theme.fg("accent", s);
    const sizes = this.manager.getFileSize(proc.id);
    const totalSize = sizes ? sizes.stdout + sizes.stderr : 0;
    const cursor = selected ? accent("> ") : "  ";
    const nameId = `${proc.name} ${dim(`(${proc.id})`)}`;
    const status = this.formatStatus(proc);
    const runtime = dim(formatRuntime(proc.startTime, proc.endTime));
    const size = dim(formatBytes(totalSize));

    const tailPlain = `${statusLabel(proc)} ${formatRuntime(proc.startTime, proc.endTime)} ${formatBytes(totalSize)}`;
    const tailWidth = Math.min(30, Math.max(0, visibleWidth(tailPlain) + 2));
    const nameWidth = Math.max(4, width - visibleWidth(cursor) - tailWidth);
    const name = selected
      ? accent(truncateToWidth(proc.name, nameWidth, ""))
      : truncateToWidth(proc.name, nameWidth, "");
    const idPart = dim(` (${proc.id})`);
    const left = truncateToWidth(`${name}${idPart}`, nameWidth, "");
    const tail = `${status} ${runtime} ${size}`;

    return `${cursor}${fitCell(left || nameId, nameWidth)}${fitCell(tail, tailWidth, "right")}`;
  }

  private buildRightPane(proc: ProcessInfo, width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const lines: string[] = [];
    const field = (label: string, value: string): void => {
      const labelText = dim(`${label.padEnd(7)} `);
      const valueWidth = Math.max(0, width - visibleWidth(labelText));
      lines.push(`${labelText}${truncateToWidth(value, valueWidth, "")}`);
    };

    field("name", `${proc.name} (${proc.id})`);
    field("command", proc.command);
    field("cwd", formatPath(proc.cwd));
    field("pid", String(proc.pid));
    field("status", stripAnsi(statusLabel(proc)));
    field("started", formatDateTime(proc.startTime));
    field("ended", formatDateTime(proc.endTime));
    field("stdout", formatPath(proc.stdoutFile));
    field("stderr", formatPath(proc.stderrFile));

    const logLines = this.getLogLines(proc, this.logTailLimit());
    const maxOffset = Math.max(0, logLines.length - this.lastLogHeight);
    if (this.logScrollOffset > maxOffset) this.logScrollOffset = maxOffset;
    const startIdx = Math.max(
      0,
      logLines.length - this.lastLogHeight - this.logScrollOffset,
    );
    const endIdx = Math.min(logLines.length, startIdx + this.lastLogHeight);
    this.scrollInfo = {
      above: startIdx,
      below: Math.max(0, logLines.length - endIdx),
    };

    const scrollHint = formatScrollInfo(
      this.scrollInfo.above,
      this.scrollInfo.below,
    );
    lines.push(
      flatRule(theme, scrollHint ? `output · ${scrollHint}` : "output", width),
    );

    if (logLines.length === 0) {
      lines.push(dim("(no output yet)"));
      return lines;
    }

    for (const line of logLines.slice(startIdx, endIdx)) {
      const text = truncateToWidth(stripAnsi(line.text), width, "");
      lines.push(line.type === "stderr" ? theme.fg("warning", text) : text);
    }

    return lines;
  }

  private getLogLines(
    proc: ProcessInfo,
    tailLines: number,
  ): { type: "stdout" | "stderr"; text: string }[] {
    const output = this.manager.getCombinedOutput(proc.id, tailLines);
    if (output) return output;

    const splitOutput = this.manager.getOutput(proc.id, tailLines);
    if (!splitOutput) return [];
    return [
      ...splitOutput.stdout.map((text) => ({ type: "stdout" as const, text })),
      ...splitOutput.stderr.map((text) => ({ type: "stderr" as const, text })),
    ];
  }

  private topBorder(
    leftWidth: number,
    rightWidth: number,
    processes: ProcessInfo[],
    selected: ProcessInfo | undefined,
  ): string {
    const running = processes.filter(
      (proc) => proc.status === "running",
    ).length;
    const leftTail = `${running} running`;
    const leftSegment = titledTopSegment(this.theme, {
      width: leftWidth,
      label: "Processes",
      tail: leftTail,
      labelColor: this.focus === "list" ? "accent" : "text",
      labelBold: this.focus === "list",
    });
    const rightSegment = titledTopSegment(this.theme, {
      width: rightWidth,
      label: selected ? selected.name : "(no selection)",
      tail: selected ? statusLabel(selected) : "",
      tailRendered: selected ? this.formatStatus(selected) : "",
      tailPlain: selected ? statusLabel(selected) : "",
      labelColor: this.focus === "log" ? "accent" : "text",
      labelBold: this.focus === "log",
    });
    const corner = (s: string) => this.theme.fg("dim", s);
    return `${corner("╭")}${leftSegment}${corner("┬")}${rightSegment}${corner("╮")}`;
  }

  private bottomBorder(
    leftWidth: number,
    rightWidth: number,
    totalProcesses: number,
  ): string {
    const leftHint =
      totalProcesses > 0
        ? `${this.selectedIndex + 1}/${totalProcesses}  tab focus  enter stream  x term/kill  c clear`
        : "tab focus  q quit";
    const maxLogScroll = this.maxLogScrollOffset();
    const rightScroll =
      maxLogScroll > 0 ? `  ${this.logScrollOffset}/${maxLogScroll}` : "";
    const rightHint = `j/k scroll  J/K page  g/G top/bottom  q quit${rightScroll}`;
    const leftSegment = titledBottomSegment(
      this.theme,
      leftWidth,
      leftHint,
      this.focus === "list",
    );
    const rightSegment = titledBottomSegment(
      this.theme,
      rightWidth,
      rightHint,
      this.focus === "log",
    );
    const corner = (s: string) => this.theme.fg("dim", s);
    return `${corner("╰")}${leftSegment}${corner("┴")}${rightSegment}${corner("╯")}`;
  }

  private bodyRow(
    left: string,
    right: string,
    leftWidth: number,
    rightWidth: number,
  ): string {
    const border = this.theme.fg("dim", "│");
    const leftCell = padRight(truncateToWidth(left, leftWidth, ""), leftWidth);
    const rightCell = padRight(
      truncateToWidth(right, rightWidth, ""),
      rightWidth,
    );
    return `${border}${leftCell}${border}${rightCell}${border}`;
  }

  private invalidateAndRender(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  private formatStatus(proc: ProcessInfo): string {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const success = (s: string) => theme.fg("success", s);
    const warning = (s: string) => theme.fg("warning", s);
    const error = (s: string) => theme.fg("error", s);

    const icon = statusIcon(proc.status, proc.success);
    const label = statusLabel(proc);

    switch (proc.status) {
      case "running":
        return success(`${icon} ${label}`);
      case "terminating":
        return warning(`${icon} ${label}`);
      case "terminate_timeout":
        return error(`${icon} ${label}`);
      case "killed":
        return warning(`${icon} ${label}`);
      case "exited":
        return proc.success
          ? dim(`${icon} ${label}`)
          : error(`${icon} ${label}`);
      default:
        return dim(`${icon} ${label}`);
    }
  }
}
