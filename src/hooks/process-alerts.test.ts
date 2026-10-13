import { describe, expect, it, vi } from "vitest";
import type { ManagerEvent, ProcessInfo } from "../constants/index.ts";
import { setupProcessEndHook } from "./process-end.ts";
import { setupProcessWatchHook } from "./process-watch.ts";

function harness() {
  const listeners: ((event: ManagerEvent) => void)[] = [];
  const manager = {
    onEvent: (listener: (event: ManagerEvent) => void) => {
      listeners.push(listener);
      return () => {};
    },
  };
  const sendMessage = vi.fn();
  const pi = { sendMessage };
  setupProcessEndHook(pi as never, manager as never);
  setupProcessWatchHook(pi as never, manager as never);
  return {
    sendMessage,
    emit: (event: ManagerEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

const info: ProcessInfo = {
  id: "p1",
  name: "build",
  command: "make",
  cwd: "/",
  pid: 1,
  startTime: 1000,
  endTime: 2000,
  status: "exited",
  exitCode: 0,
  success: true,
  stdoutFile: "out",
  stderrFile: "err",
  alertOnSuccess: true,
  alertOnFailure: true,
  alertOnKill: true,
};

describe("background alerts", () => {
  it.each([
    { status: "exited", success: true, exitCode: 0 },
    { status: "exited", success: false, exitCode: 1 },
    { status: "killed", success: false, exitCode: null },
  ] as const)("queues $status/$success lifecycle alerts after the run", (state) => {
    const { emit, sendMessage } = harness();
    emit({ type: "process_ended", info: { ...info, ...state } });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        display: true,
        details: expect.objectContaining({ kind: "lifecycle" }),
      }),
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });

  it("keeps disabled lifecycle alerts passive", () => {
    const { emit, sendMessage } = harness();
    emit({ type: "process_ended", info: { ...info, alertOnSuccess: false } });
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      triggerTurn: false,
      deliverAs: "followUp",
    });
  });

  it("queues watches after the run without changing repeat cooldown", () => {
    const { emit, sendMessage } = harness();
    const event: ManagerEvent = {
      type: "process_watch_matched",
      match: {
        processId: "p1",
        processName: "build",
        processCommand: "make",
        source: "stdout",
        line: "ready",
        watch: { index: 0, pattern: "ready", stream: "both", repeat: true },
      },
    };
    emit(event);
    emit(event);
    expect(sendMessage.mock.calls.map((call) => call[1])).toEqual([
      { triggerTurn: true, deliverAs: "followUp" },
      { triggerTurn: false, deliverAs: "followUp" },
    ]);
    emit({ type: "process_ended", info });
    emit(event);
    expect(sendMessage.mock.lastCall?.[1]).toEqual({
      triggerTurn: true,
      deliverAs: "followUp",
    });
  });
});
