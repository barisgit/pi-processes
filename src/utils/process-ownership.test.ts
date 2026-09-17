import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectProcesses, ProcessOwnership } from "./process-ownership";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const platform = process.platform;
const stat = (pid: number, ppid: number, state: string, start: string) => {
  const fields = Array<string>(50).fill("0");
  fields[0] = state;
  fields[1] = String(ppid);
  fields[19] = start;
  return `${pid} (fixture with ) space) ${fields.join(" ")}\n`;
};
const row = (pid: number, ppid: number, state = "S") =>
  `${pid} ${ppid} Mon Jan  1 00:00:00 2001 ${state}\n`;

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "linux" });
  // No real PIDs are ever signaled, even if an assertion fails.
  vi.spyOn(process, "kill").mockReturnValue(true);
});
afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.restoreAllMocks();
});

it("does not adopt or signal a reused PID with stale ps ancestry", () => {
  vi.mocked(execFileSync).mockReturnValue(row(101, 1) + row(102, 101));
  vi.mocked(readFileSync).mockImplementation((path) => {
    if (path === "/proc/101/stat") return stat(101, 1, "S", "1000");
    if (path === "/proc/102/stat") return stat(102, 999, "S", "2000");
    throw new Error(`Unexpected read: ${path}`);
  });
  const ownership = new ProcessOwnership(101);
  const snapshot = inspectProcesses();
  ownership.refresh(snapshot);
  ownership.signal("SIGTERM");
  expect(process.kill).toHaveBeenCalledExactlyOnceWith(101, "SIGTERM");
  expect(snapshot?.get(102)).toEqual({
    pid: 102,
    ppid: 999,
    start: "2000",
    zombie: false,
  });
});

it.each([
  { ps: "S", proc: "Z", signaled: false },
  { ps: "Z", proc: "S", signaled: true },
])("uses proc state when ps says $ps but proc says $proc", ({
  ps,
  proc,
  signaled,
}) => {
  vi.mocked(execFileSync).mockReturnValue(row(101, 1, ps));
  vi.mocked(readFileSync).mockReturnValue(stat(101, 1, proc, "1000"));
  const ownership = new ProcessOwnership(101);
  const snapshot = inspectProcesses();
  ownership.refresh(snapshot);
  ownership.signal("SIGTERM");
  expect(process.kill).toHaveBeenCalledTimes(signaled ? 1 : 0);
  expect(snapshot?.get(101)?.zombie).toBe(proc === "Z");
});
