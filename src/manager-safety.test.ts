import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProcessManager } from "./manager";

const managers: ProcessManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.cleanup();
});
function createManager() {
  const manager = new ProcessManager();
  managers.push(manager);
  return manager;
}
function ended(manager: ProcessManager, id: string): Promise<void> {
  return new Promise((resolve) => {
    const off = manager.onEvent((event) => {
      if (event.type === "process_ended" && event.info.id === id) {
        off();
        resolve();
      }
    });
  });
}

it.skipIf(process.platform === "win32")(
  "creates independent private log directories and exclusive private files",
  async () => {
    const first = createManager();
    const second = createManager();
    const a = first.start("privacy", "printf secret", tmpdir());
    const b = second.start("privacy", "printf secret", tmpdir());
    await Promise.all([ended(first, a.id), ended(second, b.id)]);
    expect(dirname(a.stdoutFile)).not.toBe(dirname(b.stdoutFile));
    for (const [manager, info] of [
      [first, a],
      [second, b],
    ] as const) {
      expect(statSync(dirname(info.stdoutFile)).mode & 0o777).toBe(0o700);
      const files = manager.getLogFiles(info.id);
      assert(files);
      for (const file of Object.values(files)) {
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
      expect(manager.getFullOutput(info.id)?.stdout).toBe("secret");
    }
  },
);

function nodeCommand(code: string): string {
  return `'${process.execPath}' --input-type=module -e '${code.replaceAll("'", "'\\''")}'`;
}

it("bounds watch input for unterminated output while preserving full logs", async () => {
  const manager = createManager();
  const matchedLengths: number[] = [];
  manager.onEvent((event) => {
    if (event.type === "process_watch_matched")
      matchedLengths.push(event.match.line.length);
  });
  const bytes = 16 * 1024 * 1024;
  const before = process.memoryUsage();
  let lastTick = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - lastTick);
    lastTick = now;
  }, 20);
  try {
    const info = manager.start(
      "unterminated",
      nodeCommand(`
      import { once } from "node:events";
      const chunk = Buffer.alloc(65536, "x");
      for (let i = 0; i < 256; i++) {
        if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
      }
      process.stdin.once("data", () => { process.stdout.write("\\n"); process.exitCode = 0; process.stdin.destroy(); });
    `),
      tmpdir(),
      { logWatches: [{ pattern: "^x+$" }] },
    );
    await expect
      .poll(() => manager.getFileSize(info.id)?.stdout, { timeout: 10000 })
      .toBe(bytes);
    const pending = process.memoryUsage();
    console.log(
      JSON.stringify({
        fixtureBytes: bytes,
        pendingHeapDelta: pending.heapUsed - before.heapUsed,
        pendingRssDelta: pending.rss - before.rss,
        maxTimerGapMs: Math.round(maxGap),
      }),
    );
    const done = ended(manager, info.id);
    expect(manager.writeToStdin(info.id, "finish", { end: true }).ok).toBe(
      true,
    );
    await done;
    expect(manager.getFullOutput(info.id)?.stdout).toBe(
      `${"x".repeat(bytes)}\n`,
    );
    const files = manager.getLogFiles(info.id);
    assert(files);
    expect(readFileSync(files.combinedFile, "utf8")).toBe(
      `1:${"x".repeat(bytes)}\n`,
    );
    expect(matchedLengths).toEqual([65536]);
  } finally {
    clearInterval(timer);
  }
}, 15000);

it("handles CR progress and split CRLF without duplicate matches or UTF-8 corruption", async () => {
  const manager = createManager();
  const matches: { source: string; line: string; index: number }[] = [];
  manager.onEvent((event) => {
    if (event.type === "process_watch_matched")
      matches.push({
        source: event.match.source,
        line: event.match.line,
        index: event.match.watch.index,
      });
  });
  const info = manager.start(
    "progress",
    nodeCommand(`
    process.stdout.write(Buffer.from([0xe2]));
    setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac, 13])), 30);
    process.stdin.once("data", () => {
      process.stdout.write("\\nnext\\r\\n\\nlast");
      process.stderr.write("err\\r\\nerr\\r");
      process.stdin.destroy();
    });
  `),
    tmpdir(),
    {
      logWatches: [
        { pattern: ".*", stream: "stdout", repeat: true },
        { pattern: "err", stream: "stderr" },
      ],
    },
  );
  await expect
    .poll(() => matches, { timeout: 1000 })
    .toEqual([{ source: "stdout", line: "€", index: 0 }]);
  const done = ended(manager, info.id);
  manager.writeToStdin(info.id, "finish", { end: true });
  await done;
  expect(
    matches
      .filter((match) => match.source === "stdout")
      .map((match) => match.line),
  ).toEqual(["€", "next", "", "last"]);
  expect(matches.filter((match) => match.source === "stderr")).toEqual([
    { source: "stderr", line: "err", index: 1 },
  ]);
  expect(manager.getFullOutput(info.id)).toEqual({
    stdout: "€\r\nnext\r\n\nlast",
    stderr: "err\r\nerr\r",
  });
  expect(
    manager
      .getCombinedOutput(info.id)
      ?.filter((line) => line.type === "stdout")
      .map((line) => line.text),
  ).toEqual(["€", "next", "", "last"]);
  expect(
    manager
      .getCombinedOutput(info.id)
      ?.filter((line) => line.type === "stderr")
      .map((line) => line.text),
  ).toEqual(["err", "err"]);
});

it("allows cleanup while a process has an unfinished line", async () => {
  const manager = createManager();
  const info = manager.start(
    "cleanup",
    nodeCommand('process.stdout.write("pending"); process.stdin.resume();'),
    tmpdir(),
  );
  await expect.poll(() => manager.getFileSize(info.id)?.stdout).toBe(7);
  const done = ended(manager, info.id);
  await manager.cleanup();
  await done;
});

it("processes many short lines without long event-loop stalls", async () => {
  const manager = createManager();
  const line = `${"x".repeat(43)}\n`;
  const count = 100000;
  let matches = 0;
  manager.onEvent((event) => {
    if (event.type === "process_watch_matched") matches++;
  });
  const started = performance.now();
  let lastTick = started;
  let maxGap = 0;
  const tick = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - lastTick);
    lastTick = now;
  };
  const timer = setInterval(tick, 20);
  try {
    const info = manager.start(
      "short-lines",
      nodeCommand(`
      import { once } from "node:events";
      const chunk = ("x".repeat(43) + "\\n").repeat(1000);
      for (let i = 0; i < 100; i++) {
        if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
      }
    `),
      tmpdir(),
      { logWatches: [{ pattern: "not-present", repeat: true }] },
    );
    await ended(manager, info.id);
    tick();
    const elapsed = performance.now() - started;
    clearInterval(timer);
    console.log(
      JSON.stringify({
        workload: "100000 x 44-byte lines",
        bytes: line.length * count,
        elapsedMs: Math.round(elapsed),
        maxTimerGapMs: Math.round(maxGap),
      }),
    );
    expect(manager.getFullOutput(info.id)).toEqual({
      stdout: line.repeat(count),
      stderr: "",
    });
    const files = manager.getLogFiles(info.id);
    assert(files);
    expect(readFileSync(files.combinedFile, "utf8")).toBe(
      `1:${line}`.repeat(count),
    );
    expect(matches).toBe(0);
    expect(elapsed).toBeLessThan(2000);
    expect(maxGap).toBeLessThan(500);
  } finally {
    clearInterval(timer);
  }
}, 30000);
