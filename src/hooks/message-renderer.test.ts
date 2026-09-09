import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { setupMessageRenderer } from "./message-renderer";

const theme = { fg: (_color: string, text: string) => text };
const lifecycle = {
  processId: "proc_1",
  processName: "live-ralph-guard-observer",
  command: "echo test",
  status: "exited",
  exitCode: 0,
  success: true,
  runtime: "12m 17s",
};

describe("process notification padding", () => {
  it.each([
    ["completed", lifecycle],
    ["failed", { ...lifecycle, success: false, exitCode: 1 }],
    ["killed", { ...lifecycle, status: "killed" }],
    ["fallback", undefined],
    [
      "watch matched",
      {
        ...lifecycle,
        kind: "watch_matched",
        source: "stdout",
        line: "ready",
        watch: { index: 0, pattern: "ready", stream: "both", repeat: false },
      },
    ],
  ])("pads %s notifications without adding vertical space", (_name, details) => {
    let render: (
      message: unknown,
      options: unknown,
      theme: unknown,
    ) => Component = () => {
      throw new Error("Renderer not registered");
    };
    setupMessageRenderer({
      registerMessageRenderer: (_type: string, renderer: typeof render) => {
        render = renderer;
      },
    } as never);
    const component = render(
      { content: "Process update", details },
      { expanded: false },
      theme,
    );
    for (const width of [40, 120]) {
      const lines = component.render(width);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.startsWith(" ")).toBe(true);
        expect(line.endsWith(" ")).toBe(true);
        expect(line.trim().length).toBeGreaterThan(0);
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
    expect(component.render(120)).toHaveLength(1);
  });
});
