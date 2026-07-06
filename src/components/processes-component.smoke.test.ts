import { beforeAll, describe, expect, it } from "vitest";
import { configLoader } from "../config";
import { stripAnsi } from "../utils";
import { ProcessesComponent } from "./processes-component";

const now = Date.now();

function makeProc(id: string, status: string, overrides: object = {}) {
  return {
    id,
    name: `proc-${id}`,
    command: `echo hello from ${id}`,
    cwd: "/Users/blaz/tmp",
    pid: 1234,
    status,
    success: status === "exited" ? true : null,
    startTime: now - 65_000,
    endTime: status === "running" ? null : now - 1_000,
    stdoutFile: `/tmp/logs/${id}-stdout.log`,
    stderrFile: `/tmp/logs/${id}-stderr.log`,
    ...overrides,
  };
}

function makeManager(procs: ReturnType<typeof makeProc>[]) {
  return {
    list: () => procs,
    onEvent: () => () => {},
    getFileSize: () => ({ stdout: 2048, stderr: 100 }),
    getCombinedOutput: (_id: string, n: number) =>
      Array.from({ length: Math.min(n, 40) }, (_, i) => ({
        type: "stdout" as const,
        text: `tick ${i}`,
      })),
    getOutput: () => ({ stdout: ["a"], stderr: ["b"] }),
    kill: async () => {},
    clearFinished: () => 0,
  };
}

const fakeTheme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
};

describe("ProcessesComponent two-pane render", () => {
  beforeAll(async () => {
    await configLoader.load();
  });

  it("renders aligned borders at width 120", () => {
    const mgr = makeManager([
      makeProc("p1", "running"),
      makeProc("p2", "exited"),
      makeProc("p3", "killed"),
    ]);
    const c = new ProcessesComponent(
      { requestRender: () => {} },
      fakeTheme as never,
      () => {},
      mgr as never,
    );
    const lines = c.render(120);
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      const plain = stripAnsi(line);
      expect(plain.length).toBe(120);
    }
    const joined = stripAnsi(lines.join("\n"));
    expect(joined).toContain("Processes");
    expect(joined).toContain("proc-p1");
    expect(joined).toContain("tick");
    // borders
    expect(stripAnsi(lines[0] ?? "")).toMatch(/^╭.*┬.*╮$/);
    expect(stripAnsi(lines[lines.length - 1] ?? "")).toMatch(/^╰.*┴.*╯$/);
  });

  it("renders empty state without crashing", () => {
    const mgr = makeManager([]);
    const c = new ProcessesComponent(
      { requestRender: () => {} },
      fakeTheme as never,
      () => {},
      mgr as never,
    );
    const lines = c.render(80);
    const joined = stripAnsi(lines.join("\n"));
    expect(joined).toContain("No background processes");
    for (const line of lines) {
      expect(stripAnsi(line).length).toBe(80);
    }
  });

  it("renders at narrow width 60 without overflow", () => {
    const mgr = makeManager([makeProc("p1", "running")]);
    const c = new ProcessesComponent(
      { requestRender: () => {} },
      fakeTheme as never,
      () => {},
      mgr as never,
    );
    for (const line of c.render(60)) {
      expect(stripAnsi(line).length).toBe(60);
    }
  });
});
