import { execFileSync } from "node:child_process";
import type * as FileSystem from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { ProcessManager } from "./manager";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const nativePlatform = process.platform;
for (const platform of new Set([nativePlatform, "linux"])) {
  for (const failure of [
    "inspection error",
    "identity mismatch",
    "pre-signal mismatch",
  ]) {
    it(`${platform}: never signals on ${failure} and retains unresolved logs/records`, async () => {
      const fs = await vi.importActual<typeof FileSystem>("node:fs");
      let targetPid: number | undefined;
      let mismatch = false;
      let inspectingSignalTarget = false;
      const procRead = vi
        .mocked(readFileSync)
        .mockImplementation((path, options) => {
          const proc = String(path).match(/^\/proc\/(\d+)\/stat$/);
          if (!proc) return fs.readFileSync(path, options);
          // Exercise the Linux manager path on macOS too. Real Linux uses its
          // actual proc records; only the target's start ticks are altered.
          let stat: string;
          if (nativePlatform === "linux") stat = fs.readFileSync(path, "utf8");
          else {
            const fields = Array<string>(50).fill("0");
            fields[0] = "S";
            fields[1] = "1";
            fields[19] = "1000";
            stat = `${proc[1]} (identity-fixture) ${fields.join(" ")}`;
          }
          if (
            Number(proc[1]) === targetPid &&
            mismatch &&
            (failure === "identity mismatch" || inspectingSignalTarget)
          ) {
            const offset = stat.lastIndexOf(")") + 2;
            const fields = stat.slice(offset).split(" ");
            fields[19] += "1";
            stat = stat.slice(0, offset) + fields.join(" ");
          }
          return stat;
        });
      Object.defineProperty(process, "platform", { value: platform });
      const manager = new ProcessManager();
      const info = manager.start(
        "identity-fixture",
        `exec '${process.execPath}' -e 'console.log("ready"); process.stdin.on("data", () => process.exit(0)); setTimeout(() => process.exit(0), 15000)'`,
        tmpdir(),
      );
      targetPid = info.pid;
      try {
        await expect
          .poll(() => manager.getFullOutput(info.id)?.stdout)
          .toContain("ready");
        const inspection = vi.mocked(execFileSync);
        mismatch = true;
        if (failure === "inspection error")
          inspection.mockImplementation(() => {
            throw new Error("inspection unavailable");
          });
        else if (failure === "pre-signal mismatch") {
          const snapshot = execFileSync(
            "/bin/ps",
            ["-A", "-o", "pid=,ppid=,lstart=,stat="],
            { encoding: "utf8" },
          );
          inspection.mockImplementation((_file, args) => {
            inspectingSignalTarget = Array.isArray(args) && args.includes("-p");
            return inspectingSignalTarget
              ? `${info.pid} 1 Mon Jan  1 00:00:00 2001 S\n`
              : snapshot;
          });
        } else
          inspection.mockReturnValue(
            `${info.pid} 1 Mon Jan  1 00:00:00 2001 S\n`,
          );
        // Stub even unexpected signals: failures must not kill the fixture.
        const signal = vi.spyOn(process, "kill").mockReturnValue(true);
        try {
          expect((await manager.kill(info.id, { timeoutMs: 20 })).ok).toBe(
            false,
          );
          expect(signal.mock.calls).toHaveLength(0);
          expect(manager.get(info.id)?.status).toBe("terminate_timeout");
          expect(manager.clearFinished()).toBe(0);
          expect(existsSync(info.stdoutFile)).toBe(true);
          if (failure === "inspection error") {
            await manager.cleanup();
            expect(manager.get(info.id)).not.toBeNull();
            expect(existsSync(info.stdoutFile)).toBe(true);
          }
        } finally {
          signal.mockRestore();
          inspection.mockRestore();
          mismatch = false;
        }
      } finally {
        try {
          manager.writeToStdin(info.id, "finish\n");
          await expect
            .poll(() => manager.get(info.id)?.status, { timeout: 3000 })
            .toBe("killed");
          await manager.cleanup();
        } finally {
          procRead.mockRestore();
          Object.defineProperty(process, "platform", { value: nativePlatform });
        }
      }
    }, 12000);
  }
}
