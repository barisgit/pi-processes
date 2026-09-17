import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { ProcessManager } from "./manager";

const fixture = resolve("src/test/owned-workload.mjs");
const roles = ["root", "same-group", "detached", "nested"];
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

for (const scenario of ["stop", "launcher exit", "quit", "spawn during stop"]) {
  it(scenario, async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-owned-fixture-"));
    const otherDir = mkdtempSync(join(tmpdir(), "pi-unrelated-fixture-"));
    const unrelated = spawn(
      process.execPath,
      [fixture, otherDir, "unrelated"],
      { stdio: "ignore" },
    );
    const manager = new ProcessManager();
    const events: string[] = [];
    manager.onEvent((event) => {
      if (event.type === "process_ended") events.push(event.info.id);
    });
    const info = manager.start(
      "disposable",
      `exec ${quote(process.execPath)} ${quote(fixture)} ${quote(dir)} root`,
      dir,
    );
    const pids = () =>
      [...roles, "late"]
        .filter((role) => existsSync(join(dir, `${role}.json`)))
        .map(
          (role) =>
            JSON.parse(readFileSync(join(dir, `${role}.json`), "utf8"))
              .pid as number,
        );
    const unrelatedPid = unrelated.pid;
    if (!unrelatedPid) throw new Error("Fixture failed to spawn");
    try {
      await expect
        .poll(
          () => roles.every((role) => existsSync(join(dir, `${role}.json`))),
          { timeout: 3000 },
        )
        .toBe(true);
      // Allow observed ancestry to be collected before deliberately reparenting.
      await delay(350);
      if (scenario === "launcher exit") {
        writeFileSync(join(dir, "exit-root"), "");
        await expect.poll(() => alive(info.pid)).toBe(false);
        await delay(200);
        expect(manager.get(info.id)?.status).toBe("running");
        expect(manager.clearFinished()).toBe(0);
        expect(existsSync(info.stdoutFile)).toBe(true);
      }
      if (scenario === "spawn during stop")
        writeFileSync(join(dir, "spawn-on-stop"), "");
      if (scenario === "quit") await manager.cleanup();
      else {
        const results = await Promise.all([
          manager.kill(info.id, { timeoutMs: 600 }),
          manager.kill(info.id, { timeoutMs: 600 }),
        ]);
        expect(results.every((result) => result.ok)).toBe(true);
      }
      if (scenario === "spawn during stop")
        expect(existsSync(join(dir, "late.json"))).toBe(true);
      await expect
        .poll(() => pids().every((pid) => !alive(pid)), { timeout: 2000 })
        .toBe(true);
      if (scenario !== "launcher exit")
        expect(readFileSync(join(dir, "root-terms"), "utf8")).toBe("term\n");
      expect(alive(unrelatedPid)).toBe(true);
      expect(events).toEqual([info.id]);
      if (scenario !== "quit") expect(manager.clearFinished()).toBe(1);
    } finally {
      writeFileSync(join(dir, "stop"), "");
      writeFileSync(join(otherDir, "stop"), "");
      await expect
        .poll(() => [...pids(), unrelatedPid].every((pid) => !alive(pid)), {
          timeout: 3000,
        })
        .toBe(true);
      await manager.cleanup();
      rmSync(dir, { recursive: true, force: true });
      rmSync(otherDir, { recursive: true, force: true });
    }
  }, 12000);
}
