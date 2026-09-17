import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import {
  MESSAGE_TYPE_PROCESS_UPDATE,
  type ProcessesDetails,
} from "./constants";
import extension from "./index";

async function execute(session: AgentSession, params: Record<string, unknown>) {
  const runner = session.extensionRunner;
  const tool = runner.getToolDefinition("process");
  if (!tool) throw new Error("Process tool not registered");
  const result = await tool.execute(
    "fixture",
    params,
    undefined,
    undefined,
    runner.createContext(),
  );
  return result.details as ProcessesDetails;
}

it("composed SDK reload preserves IDs/logs/output/control and binds notifications once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-reload-test-"));
  const sessions: AgentSession[] = [];
  const errors: unknown[] = [];
  const loaders = new Map<AgentSession, DefaultResourceLoader>();
  async function create() {
    const settingsManager = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [extension],
    });
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      sessionManager: SessionManager.inMemory(dir),
      resourceLoader: loader,
      tools: [],
    });
    expect(extensionsResult.errors).toEqual([]);
    sessions.push(session);
    loaders.set(session, loader);
    await session.bindExtensions({ onError: (error) => errors.push(error) });
    return session;
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const session = await create();
    const other = await create();
    const started = await execute(session, {
      action: "start",
      name: "reload-fixture",
      command: `exec '${process.execPath}' -e 'console.log("before"); process.stdin.on("data", d => console.log(d.toString().trim())); setTimeout(() => process.exit(0), 15000)'`,
      alertOnFailure: false,
    });
    const info = started.process;
    if (!info) throw new Error("Fixture not started");
    expect(started.success).toBe(true);
    await expect
      .poll(
        async () =>
          (await execute(session, { action: "output", id: info.id })).output
            ?.stdout,
      )
      .toContain("before");
    for (let i = 0; i < 3; i++) {
      await session.reload();
      expect(alive(info.pid)).toBe(true);
      const list = await execute(session, { action: "list" });
      expect(list.processes).toHaveLength(1);
      expect(list.processes?.[0]).toMatchObject({
        id: info.id,
        pid: info.pid,
        stdoutFile: info.stdoutFile,
        status: "running",
      });
      expect(existsSync(info.stdoutFile)).toBe(true);
    }
    expect((await execute(other, { action: "list" })).processes).toEqual([]);
    await other.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    sessions.splice(sessions.indexOf(other), 1);
    other.dispose();
    expect(alive(info.pid)).toBe(true);
    await execute(session, { action: "write", id: info.id, input: "after\n" });
    await expect
      .poll(
        async () =>
          (await execute(session, { action: "output", id: info.id })).output
            ?.stdout,
      )
      .toContain("after");
    expect(
      (await execute(session, { action: "kill", id: info.id })).success,
    ).toBe(true);
    expect(alive(info.pid)).toBe(false);
    const updates = session.agent.state.messages.filter(
      (message) =>
        message.role === "custom" &&
        message.customType === MESSAGE_TYPE_PROCESS_UPDATE,
    );
    expect(updates).toHaveLength(1);
    expect(errors).toEqual([]);

    // Force a one-shot watch and failure to arrive AFTER shutdown(reload),
    // BEFORE the replacement extension's session_start. No model/network calls.
    const send = session.sendCustomMessage.bind(session);
    const messages = vi
      .spyOn(session, "sendCustomMessage")
      .mockImplementation((message, options) =>
        send(message, { ...options, triggerTurn: false }),
      );
    const finish = join(dir, "finish-handoff");
    const handoff = await execute(session, {
      action: "start",
      name: "handoff-fixture",
      command: `exec '${process.execPath}' -e 'const fs = require("node:fs"); const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(finish)})) { console.log("handoff-ready"); clearInterval(t); process.exitCode = 1; } }, 10); setTimeout(() => process.exit(0), 15000).unref()'`,
      logWatches: [{ pattern: "handoff-ready" }],
    });
    const handoffInfo = handoff.process;
    if (!handoffInfo) throw new Error("Handoff fixture not started");
    const loader = loaders.get(session);
    if (!loader) throw new Error("Loader missing");
    const reload = loader.reload.bind(loader);
    vi.spyOn(loader, "reload").mockImplementationOnce(async () => {
      writeFileSync(finish, "");
      await expect.poll(() => alive(handoffInfo.pid)).toBe(false);
      await delay(200);
      await reload();
    });
    await session.reload();
    expect(messages.mock.calls).toHaveLength(2);
    expect(
      messages.mock.calls.map(
        ([message]) => (message.details as { kind: string }).kind,
      ),
    ).toEqual(["watch_matched", "lifecycle"]);
    expect(
      messages.mock.calls.every(([, options]) => options?.triggerTurn),
    ).toBe(true);
    await session.reload();
    expect(messages.mock.calls).toHaveLength(2);
    messages.mockRestore();
    const quit = await execute(session, {
      action: "start",
      name: "quit-fixture",
      command: `exec '${process.execPath}' -e 'setTimeout(() => {}, 15000)'`,
      alertOnFailure: false,
    });
    const quitInfo = quit.process;
    if (!quitInfo) throw new Error("Quit fixture not started");
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    expect(alive(quitInfo.pid)).toBe(false);
    expect(existsSync(quitInfo.stdoutFile)).toBe(false);
    sessions.splice(sessions.indexOf(session), 1);
    session.dispose();
    expect(errors).toEqual([]);
  } finally {
    for (const session of sessions) {
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      });
      session.dispose();
    }
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
