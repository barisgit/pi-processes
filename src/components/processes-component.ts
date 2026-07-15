import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { type PaneOverlayComponent, paneOverlay } from "pi-extension-utils";
import { configLoader } from "../config";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { stripAnsi } from "../utils";
import { flatRule, formatPath } from "./render-helpers";
import { statusIcon, statusLabel } from "./status-format";

const MIN_LEFT_PANE = 30;
const MIN_RIGHT_PANE = 36;
const LEFT_PANE_CAP = 72;
const DEFAULT_LEFT_FRACTION = 0.38;
const SPLIT_STEP_COLS = 4;
const MIN_BODY_HEIGHT = 18;
const CHROME_ROWS = 2;

function computeBodyHeight(tui: unknown): number {
  const rows =
    (tui as { terminal?: { rows?: number } })?.terminal?.rows ??
    process.stdout.rows ??
    32;
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

export class ProcessesComponent implements Component {
  private overlay: PaneOverlayComponent;
  private unsubscribe: (() => void) | null;

  constructor(
    private tui: { requestRender: () => void },
    private theme: Theme,
    private onClose: (processId?: string) => void,
    private manager: ProcessManager,
  ) {
    this.overlay = this.createPaneOverlay();
    this.unsubscribe = this.manager.onEvent(() => {
      this.tui.requestRender();
    });
  }

  private createPaneOverlay(): PaneOverlayComponent {
    const factory = paneOverlay<string | undefined, ProcessInfo>({
      height: computeBodyHeight,
      primary: {
        mode: "cursor",
        rows: () => this.manager.list(),
        selectionKey: (proc) => proc.id,
        renderRow: (proc, ctx) =>
          this.renderProcessRow(
            proc,
            proc.id === ctx.selectedKey,
            Math.max(1, ctx.primary.width),
          ),
        title: () => {
          const processes = this.manager.list();
          const running = processes.filter(
            (proc) => proc.status === "running",
          ).length;
          return { label: "Processes", tail: `${running} running` };
        },
        footer: (ctx) => {
          const total = this.manager.list().length;
          return total > 0 ? `${ctx.selectedIndex + 1}/${total}` : "";
        },
      },
      detail: {
        rows: (ctx) => {
          const selected = ctx.selectedRow;
          return selected
            ? this.buildRightPane(selected, Math.max(1, ctx.detail.width))
            : [this.theme.fg("dim", "No background processes")];
        },
        title: (ctx) => {
          const selected = ctx.selectedRow;
          if (!selected) return "(no selection)";
          return {
            label: selected.name,
            tail: statusLabel(selected),
            tailRendered: this.formatStatus(selected),
            tailPlain: statusLabel(selected),
          };
        },
      },
      closeKeys: ["escape", "q"],
      legendPlacement: "primary",
      collapse: { key: "s", label: "sidebar", collapsedWidth: 0 },
      perSelectionScroll: true,
      stickyBottom: true,
      split: {
        initialFraction: DEFAULT_LEFT_FRACTION,
        minPrimaryWidth: MIN_LEFT_PANE,
        minDetailWidth: MIN_RIGHT_PANE,
        maxPrimaryWidth: LEFT_PANE_CAP,
        stepCols: SPLIT_STEP_COLS,
      },
      customActions: [
        {
          keys: "return",
          label: "stream",
          run: (ctx) => {
            if (ctx.selectedRow) ctx.close(ctx.selectedRow.id);
          },
        },
        {
          keys: "x",
          label: "term/kill",
          run: (ctx) => this.killSelected(ctx.selectedRow),
        },
        {
          keys: ["c", "C"],
          label: "clear finished",
          run: () => {
            this.manager.clearFinished();
          },
        },
      ],
    });

    return factory(this.tui as never, this.theme, undefined, (processId) => {
      this.cleanupListener();
      this.onClose(processId);
    }) as PaneOverlayComponent;
  }

  private killSelected(proc: ProcessInfo | undefined): void {
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

  handleInput(data: string): void {
    this.overlay.handleInput(data);
  }

  invalidate(): void {
    // paneOverlay resolves rows and detail output lazily during render.
  }

  render(width: number): string[] {
    return this.overlay.render(width);
  }

  dispose(): void {
    this.cleanupListener();
    this.overlay.dispose();
  }

  private cleanupListener(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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
    lines.push(flatRule(theme, "output", width));

    if (logLines.length === 0) {
      lines.push(dim("(no output yet)"));
      return lines;
    }

    for (const line of logLines) {
      const text = truncateToWidth(stripAnsi(line.text), width, "");
      lines.push(line.type === "stderr" ? theme.fg("warning", text) : text);
    }

    return lines;
  }

  private logTailLimit(): number {
    const cfg = configLoader.getConfig().processList;
    const detailHeight = Math.max(1, computeBodyHeight(this.tui) - 10);
    return Math.max(cfg.maxPreviewLines * 4, detailHeight * 4, 100);
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
