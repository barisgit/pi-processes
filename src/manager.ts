import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

import {
  type KillResult,
  LIVE_STATUSES,
  type LogWatch,
  type LogWatchStream,
  type ManagerEvent,
  type ProcessInfo,
  type ProcessStatus,
  type StartOptions,
  type WriteResult,
} from "./constants";
import { spawnCommand } from "./utils/command-executor";
import { LogLines } from "./utils/log-lines";
import { inspectProcesses, ProcessOwnership } from "./utils/process-ownership";

interface ResolvedWatch {
  index: number;
  pattern: string;
  regex: RegExp;
  stream: LogWatchStream;
  repeat: boolean;
  fired: boolean;
}

interface ManagedProcess extends ProcessInfo {
  process: ChildProcess;
  stdin: Writable | null;
  stdinClosed: boolean;
  lastSignalSent: NodeJS.Signals | null;
  combinedFile: string;
  stdoutLines: LogLines;
  stderrLines: LogLines;
  watches: ResolvedWatch[];
  ownership: ProcessOwnership | null;
  launcherClosed: boolean;
  launcherSignal: NodeJS.Signals | null;
}

interface ProcessManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private counter = 0;
  private stops = new Map<string, Promise<KillResult>>();
  private logDir: string;
  private events = new EventEmitter();
  private pendingNotifications: ManagerEvent[] | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  private getConfiguredShellPath: () => string | undefined;

  private lastOutputEmitAt: Map<string, number> = new Map();
  private pendingOutputEmit: Map<string, NodeJS.Timeout> = new Map();

  constructor(options?: ProcessManagerOptions) {
    this.logDir = mkdtempSync(join(tmpdir(), "pi-processes-"));
    this.getConfiguredShellPath =
      options?.getConfiguredShellPath ?? (() => undefined);
  }

  onEvent(listener: (event: ManagerEvent) => void): () => void {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  private emit(event: ManagerEvent): void {
    if (
      this.pendingNotifications &&
      (event.type === "process_ended" || event.type === "process_watch_matched")
    ) {
      this.pendingNotifications.push(event);
      return;
    }
    this.events.emit("event", event);
  }

  deferNotifications(): void {
    this.pendingNotifications ??= [];
  }

  resumeNotifications(): void {
    const pending = this.pendingNotifications;
    this.pendingNotifications = null;
    for (const event of pending ?? []) this.emit(event);
  }

  private notifyOutputChanged(id: string): void {
    const now = Date.now();
    const lastEmit = this.lastOutputEmitAt.get(id) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= 100) {
      this.lastOutputEmitAt.set(id, now);
      this.emit({ type: "process_output_changed", id });
      return;
    }

    if (!this.pendingOutputEmit.has(id)) {
      const delay = 100 - elapsed;
      const timeout = setTimeout(() => {
        this.pendingOutputEmit.delete(id);
        // Invariant: every path that removes a process from `this.processes`
        // must call `clearOutputChangedState(id)` first, which clears this
        // timeout. This guard is a safety net, not a primary mechanism.
        if (!this.processes.has(id)) return;
        this.lastOutputEmitAt.set(id, Date.now());
        this.emit({ type: "process_output_changed", id });
      }, delay);
      this.pendingOutputEmit.set(id, timeout);
    }
  }

  private flushPendingOutputChanged(id: string): void {
    const timeout = this.pendingOutputEmit.get(id);
    if (!timeout) return;
    clearTimeout(timeout);
    this.pendingOutputEmit.delete(id);
    this.lastOutputEmitAt.set(id, Date.now());
    this.emit({ type: "process_output_changed", id });
  }

  private clearOutputChangedState(id: string): void {
    const timeout = this.pendingOutputEmit.get(id);
    if (timeout) clearTimeout(timeout);
    this.pendingOutputEmit.delete(id);
    this.lastOutputEmitAt.delete(id);
  }

  private transition(managed: ManagedProcess, next: ProcessStatus): void {
    if (managed.status === next) return;
    managed.status = next;

    if (next === "exited" || next === "killed") {
      this.emit({ type: "process_ended", info: this.toProcessInfo(managed) });
    }

    this.ensureWatcherRunning();
    this.stopWatcherIfIdle();
  }

  private ensureWatcherRunning(): void {
    if (this.watcher) return;
    if (!this.hasAliveishProcesses()) return;

    this.watcher = setInterval(() => {
      this.livenessTick();
    }, 100);
    this.watcher.unref();
  }

  private stopWatcherIfIdle(): void {
    if (!this.watcher) return;
    if (this.hasAliveishProcesses()) return;

    clearInterval(this.watcher);
    this.watcher = null;
  }

  private hasAliveishProcesses(): boolean {
    for (const p of this.processes.values()) {
      if (LIVE_STATUSES.has(p.status)) return true;
    }
    return false;
  }

  private livenessTick(): void {
    if (!this.hasAliveishProcesses()) return;
    const snapshot = inspectProcesses();
    for (const managed of this.processes.values()) {
      if (!LIVE_STATUSES.has(managed.status)) continue;
      const gone = managed.ownership?.refresh(snapshot);
      if (!gone || !managed.launcherClosed) continue;
      managed.endTime = Date.now();
      managed.success =
        managed.lastSignalSent || managed.launcherSignal
          ? false
          : managed.exitCode === 0;
      this.flushPendingOutputChanged(managed.id);
      this.flushPendingLines(managed);
      this.transition(
        managed,
        managed.lastSignalSent || managed.launcherSignal ? "killed" : "exited",
      );
    }
  }

  setConfiguredShellPath(getPath: () => string | undefined): void {
    this.getConfiguredShellPath = getPath;
  }

  start(
    name: string,
    command: string,
    cwd: string,
    options?: StartOptions,
  ): ProcessInfo {
    const resolvedWatches = this.resolveLogWatches(options?.logWatches);
    const id = `proc_${++this.counter}`;
    const stdoutFile = join(this.logDir, `${id}-stdout.log`);
    const stderrFile = join(this.logDir, `${id}-stderr.log`);
    const combinedFile = join(this.logDir, `${id}-combined.log`);

    appendFileSync(stdoutFile, "", { mode: 0o600, flag: "wx" });
    appendFileSync(stderrFile, "", { mode: 0o600, flag: "wx" });
    appendFileSync(combinedFile, "", { mode: 0o600, flag: "wx" });

    const child = spawnCommand(command, cwd, this.getConfiguredShellPath());

    child.unref();

    const managed: ManagedProcess = {
      id,
      name,
      pid: child.pid ?? -1,
      command,
      cwd,
      startTime: Date.now(),
      endTime: null,
      status: "running",
      exitCode: null,
      success: null,
      stdoutFile,
      stderrFile,
      combinedFile,
      alertOnSuccess: options?.alertOnSuccess ?? false,
      alertOnFailure: options?.alertOnFailure ?? true,
      alertOnKill: options?.alertOnKill ?? false,
      process: child,
      stdin: child.stdin,
      stdinClosed: false,
      lastSignalSent: null,
      stdoutLines: new LogLines(stdoutFile, combinedFile, "1:"),
      stderrLines: new LogLines(stderrFile, combinedFile, "2:"),
      watches: resolvedWatches,
      ownership: child.pid ? new ProcessOwnership(child.pid) : null,
      launcherClosed: false,
      launcherSignal: null,
    };

    this.processes.set(id, managed);

    // Failed spawns emit an asynchronous error even when no PID is returned.
    child.on("error", (err) => {
      try {
        appendFileSync(stderrFile, `Process error: ${err.message}\n`);
      } catch {
        // Ignore
      }

      if (!managed.endTime) {
        managed.exitCode = -1;
        managed.success = false;
        managed.endTime = Date.now();
        this.flushPendingOutputChanged(id);
        this.flushPendingLines(managed);
        this.transition(managed, "exited");
      }
    });

    if (!child.pid) {
      try {
        appendFileSync(stderrFile, "Spawn error: missing pid\n");
      } catch {
        // Ignore
      }
      managed.exitCode = -1;
      managed.success = false;
      managed.endTime = Date.now();
      this.transition(managed, "exited");
      return this.toProcessInfo(managed);
    }

    child.stdout?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stdoutFile, data);
        const lines = managed.stdoutLines.push(data);
        this.matchWatches(managed, "stdout", lines);
        this.notifyOutputChanged(id);
      } catch {
        // Ignore
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stderrFile, data);
        const lines = managed.stderrLines.push(data);
        this.matchWatches(managed, "stderr", lines);
        this.notifyOutputChanged(id);
      } catch {
        // Ignore
      }
    });

    child.on("close", (code, signal) => {
      if (managed.endTime) return;

      managed.exitCode = code;
      managed.launcherClosed = true;
      managed.launcherSignal = signal;
      this.livenessTick();
    });

    this.emit({ type: "process_started", info: this.toProcessInfo(managed) });
    this.ensureWatcherRunning();

    return this.toProcessInfo(managed);
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values())
      .map((p) => this.toProcessInfo(p))
      .reverse();
  }

  get(id: string): ProcessInfo | null {
    const managed = this.processes.get(id);
    return managed ? this.toProcessInfo(managed) : null;
  }

  getOutput(
    id: string,
    tailLines = 100,
  ): { stdout: string[]; stderr: string[]; status: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    return {
      stdout: this.readTailLines(managed.stdoutFile, tailLines),
      stderr: this.readTailLines(managed.stderrFile, tailLines),
      status: managed.status,
    };
  }

  getCombinedOutput(
    id: string,
    tailLines = 100,
  ): { type: "stdout" | "stderr"; text: string }[] | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    const rawLines = this.readTailLines(managed.combinedFile, tailLines);
    return rawLines.map((line) => {
      if (line.startsWith("2:")) {
        return { type: "stderr", text: line.slice(2) };
      }
      // Default to stdout (handles "1:" prefix and any malformed lines).
      return {
        type: "stdout",
        text: line.startsWith("1:") ? line.slice(2) : line,
      };
    });
  }

  getFullOutput(id: string): { stdout: string; stderr: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    try {
      return {
        stdout: readFileSync(managed.stdoutFile, "utf-8"),
        stderr: readFileSync(managed.stderrFile, "utf-8"),
      };
    } catch {
      return { stdout: "", stderr: "" };
    }
  }

  getLogFiles(
    id: string,
  ): { stdoutFile: string; stderrFile: string; combinedFile: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;
    return {
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      combinedFile: managed.combinedFile,
    };
  }

  kill(
    id: string,
    opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
  ): Promise<KillResult> {
    const pending = this.stops.get(id);
    if (pending) return pending;
    const stop = this.stop(id, opts).finally(() => this.stops.delete(id));
    this.stops.set(id, stop);
    return stop;
  }

  private async stop(
    id: string,
    opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
  ): Promise<KillResult> {
    const managed = this.processes.get(id);
    if (!managed) {
      return {
        ok: false,
        info: {
          id,
          name: "(unknown)",
          pid: -1,
          command: "",
          cwd: "",
          startTime: 0,
          endTime: null,
          status: "exited",
          exitCode: null,
          success: false,
          stdoutFile: "",
          stderrFile: "",
          alertOnSuccess: false,
          alertOnFailure: true,
          alertOnKill: false,
        },
        reason: "not_found",
      };
    }

    const signal = opts?.signal ?? "SIGTERM";
    const timeoutMs = opts?.timeoutMs ?? 3000;

    managed.alertOnKill = false;

    if (!LIVE_STATUSES.has(managed.status)) {
      return { ok: true, info: this.toProcessInfo(managed) };
    }

    this.transition(managed, "terminating");

    this.livenessTick();
    managed.lastSignalSent = signal;
    managed.ownership?.signal(signal, { onlyPid: managed.pid });

    const waitUntil = async (deadline: number, escalation?: NodeJS.Signals) => {
      while (Date.now() < deadline && LIVE_STATUSES.has(managed.status)) {
        this.livenessTick();
        if (escalation) managed.ownership?.signal(escalation);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      this.livenessTick();
    };

    if (signal !== "SIGKILL") {
      // Let launchers forward TERM first (some intentionally forward PID-only).
      const deadline = Date.now() + timeoutMs;
      await waitUntil(Date.now() + Math.min(500, timeoutMs / 2));
      managed.ownership?.signal(signal, { excludePid: managed.pid });
      await waitUntil(deadline);
    }
    // Re-scan while escalating, including children created during shutdown.
    await waitUntil(Date.now() + 1000, "SIGKILL");
    if (LIVE_STATUSES.has(managed.status)) {
      this.transition(managed, "terminate_timeout");
      return {
        ok: false,
        info: this.toProcessInfo(managed),
        reason: "timeout",
      };
    }
    return { ok: true, info: this.toProcessInfo(managed) };
  }

  writeToStdin(
    id: string,
    data: string,
    opts?: { end?: boolean },
  ): WriteResult {
    const managed = this.processes.get(id);
    if (!managed) {
      return {
        ok: false,
        reason: "not_found",
      };
    }

    if (!LIVE_STATUSES.has(managed.status)) {
      return {
        ok: false,
        reason: "process_exited",
      };
    }

    if (managed.stdinClosed || !managed.stdin) {
      return {
        ok: false,
        reason: "stdin_closed",
      };
    }

    try {
      managed.stdin.write(data);

      if (opts?.end) {
        managed.stdin.end();
        managed.stdinClosed = true;
      }

      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: "write_error",
      };
    }
  }

  clearFinished(): number {
    let cleared = 0;
    for (const [id, managed] of this.processes) {
      if (LIVE_STATUSES.has(managed.status)) {
        continue;
      }

      try {
        rmSync(managed.stdoutFile, { force: true });
        rmSync(managed.stderrFile, { force: true });
        rmSync(managed.combinedFile, { force: true });
      } catch {
        // Ignore
      }

      this.clearOutputChangedState(id);
      this.processes.delete(id);
      cleared++;
    }

    if (cleared > 0) {
      this.emit({ type: "processes_changed" });
    }

    this.stopWatcherIfIdle();
    return cleared;
  }

  async shutdownKillAll(): Promise<void> {
    await Promise.all(
      this.list()
        .filter((p) => LIVE_STATUSES.has(p.status))
        .map((p) => this.kill(p.id)),
    );
  }

  stopWatcher(): void {
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
  }

  async cleanup(): Promise<void> {
    await this.shutdownKillAll();
    // Unresolved ownership must remain controllable with its logs intact.
    if (this.hasAliveishProcesses()) return;
    this.stopWatcher();

    for (const timeout of this.pendingOutputEmit.values()) {
      clearTimeout(timeout);
    }
    this.pendingOutputEmit.clear();
    this.lastOutputEmitAt.clear();

    this.clearFinished();
    try {
      rmSync(this.logDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  getFileSize(id: string): { stdout: number; stderr: number } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    try {
      return {
        stdout: statSync(managed.stdoutFile).size,
        stderr: statSync(managed.stderrFile).size,
      };
    } catch {
      return { stdout: 0, stderr: 0 };
    }
  }

  private resolveLogWatches(input?: LogWatch[]): ResolvedWatch[] {
    if (!input || input.length === 0) return [];

    return input.map((watch, index) => {
      const pattern = watch.pattern?.trim();
      if (!pattern) {
        throw new Error(`logWatches[${index}].pattern is required`);
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "invalid regular expression";
        throw new Error(
          `Invalid log watch pattern at logWatches[${index}]: ${message}`,
        );
      }

      const stream = watch.stream ?? "both";
      if (stream !== "stdout" && stream !== "stderr" && stream !== "both") {
        throw new Error(
          `Invalid logWatches[${index}].stream: ${stream}. Expected stdout, stderr, or both`,
        );
      }

      return {
        index,
        pattern,
        regex,
        stream,
        repeat: watch.repeat ?? false,
        fired: false,
      };
    });
  }

  private flushPendingLines(managed: ManagedProcess): void {
    for (const source of ["stdout", "stderr"] as const) {
      try {
        const lines =
          managed[source === "stdout" ? "stdoutLines" : "stderrLines"];
        this.matchWatches(managed, source, lines.flush());
      } catch {
        // Cleanup may have removed the logs before the child close event.
      }
    }
  }

  private matchWatches(
    managed: ManagedProcess,
    source: "stdout" | "stderr",
    lines: string[],
  ): void {
    if (managed.watches.length === 0 || lines.length === 0) return;

    for (const line of lines) {
      for (const watch of managed.watches) {
        if (!watch.repeat && watch.fired) continue;
        if (watch.stream !== "both" && watch.stream !== source) continue;

        if (!watch.regex.test(line)) continue;

        watch.fired = true;

        this.emit({
          type: "process_watch_matched",
          match: {
            processId: managed.id,
            processName: managed.name,
            processCommand: managed.command,
            source,
            line,
            watch: {
              index: watch.index,
              pattern: watch.pattern,
              stream: watch.stream,
              repeat: watch.repeat,
            },
          },
        });
      }
    }
  }

  private readTailLines(filePath: string, lines: number): string[] {
    try {
      const content = readFileSync(filePath, "utf-8");
      const allLines = content.split("\n");
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      return allLines.slice(-lines);
    } catch {
      return [];
    }
  }

  private toProcessInfo(managed: ManagedProcess): ProcessInfo {
    return {
      id: managed.id,
      name: managed.name,
      pid: managed.pid,
      command: managed.command,
      cwd: managed.cwd,
      startTime: managed.startTime,
      endTime: managed.endTime,
      status: managed.status,
      exitCode: managed.exitCode,
      success: managed.success,
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      alertOnSuccess: managed.alertOnSuccess,
      alertOnFailure: managed.alertOnFailure,
      alertOnKill: managed.alertOnKill,
    };
  }
}

export type {
  KillResult,
  ManagerEvent,
  ProcessInfo,
  ProcessStatus,
  WriteResult,
};
