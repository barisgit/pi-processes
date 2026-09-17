import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface ProcessIdentity {
  pid: number;
  ppid: number;
  start: string;
  zombie: boolean;
}

export type ProcessSnapshot = Map<number, ProcessIdentity>;

// A failed inspection is unknown, never an empty (dead) process table.
export function inspectProcesses(pids?: number[]): ProcessSnapshot | null {
  try {
    const text = execFileSync(
      "/bin/ps",
      [
        ...(pids ? ["-p", pids.join(",")] : ["-A"]),
        "-o",
        "pid=,ppid=,lstart=,stat=",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        timeout: 1000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const result: ProcessSnapshot = new Map();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s*$/);
      if (!match) return null;
      const pid = Number(match[1]);
      let start = match[3];
      let ppid = Number(match[2]);
      let zombie = match[4].startsWith("Z");
      if (process.platform === "linux") {
        try {
          const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
          // ps only enumerates Linux PIDs. Read ancestry, state and identity
          // together so PID reuse between ps and proc cannot mix two processes.
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          start = fields[19];
          ppid = Number(fields[1]);
          zombie = fields[0] === "Z";
          if (!start) return null;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          return null;
        }
      }
      result.set(pid, {
        pid,
        ppid,
        start,
        zombie,
      });
    }
    return result;
  } catch (error) {
    // ps returns 1 with empty output when the requested PID no longer exists.
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    if (
      pids &&
      failure.status === 1 &&
      !failure.stdout?.trim() &&
      !failure.stderr?.trim()
    )
      return new Map();
    return null;
  }
}

export class ProcessOwnership {
  private owned: ProcessSnapshot = new Map();
  private unknownRoot = false;

  constructor(pid: number) {
    const snapshot = inspectProcesses([pid]);
    if (!snapshot) this.unknownRoot = true;
    const root = snapshot?.get(pid);
    if (root) this.owned.set(pid, root);
  }

  refresh(snapshot: ProcessSnapshot | null): boolean {
    if (!snapshot) return false;
    // Only a still-matching parent establishes ownership. Retain that ownership
    // after reparenting, but never follow a recycled PID's new children.
    const parents = new Set<number>();
    for (const [pid, identity] of this.owned) {
      if (snapshot.get(pid)?.start === identity.start) parents.add(pid);
    }
    let added = true;
    while (added) {
      added = false;
      for (const row of snapshot.values()) {
        if (!parents.has(row.pid) && parents.has(row.ppid)) {
          this.owned.set(row.pid, row);
          parents.add(row.pid);
          added = true;
        }
      }
    }
    for (const [pid, identity] of this.owned) {
      const current = snapshot.get(pid);
      if (!current || current.start !== identity.start || current.zombie)
        this.owned.delete(pid);
    }
    return !this.unknownRoot && this.owned.size === 0;
  }

  signal(
    signal: NodeJS.Signals,
    selection?: { onlyPid?: number; excludePid?: number },
  ): void {
    for (const [pid, identity] of this.owned) {
      if (selection?.onlyPid !== undefined && pid !== selection.onlyPid)
        continue;
      if (pid === selection?.excludePid) continue;
      // Reinspect EACH target immediately before signaling. No group broadcast:
      // group membership and PID ownership can change independently.
      const snapshot = inspectProcesses([pid]);
      if (!snapshot) continue;
      const current = snapshot.get(pid);
      if (!current || current.start !== identity.start || current.zombie) {
        this.owned.delete(pid);
        continue;
      }
      try {
        process.kill(pid, signal);
      } catch {
        // A subsequent inspection determines gone vs unknown/permission denied.
      }
    }
  }
}
