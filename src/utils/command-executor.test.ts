import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type * as nodeFs from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { resolveShellExecutable, spawnCommand } from "./command-executor";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return { ...actual, existsSync: vi.fn() };
});

const existsSyncMock = vi.mocked(existsSync);

describe("resolveShellExecutable", () => {
  it("prefers shell configured in settings when it is an existing absolute path", () => {
    existsSyncMock.mockImplementation(
      (path) => path === "/nix/store/abc-bash-5.3/bin/bash",
    );

    const resolved = resolveShellExecutable({
      configuredShell: "/nix/store/abc-bash-5.3/bin/bash",
      knownPaths: ["/bin/bash", "/usr/bin/bash"],
    });

    expect(resolved).toBe("/nix/store/abc-bash-5.3/bin/bash");
  });

  it("falls back to first existing known shell path", () => {
    existsSyncMock.mockImplementation((path) => path === "/usr/bin/bash");

    const resolved = resolveShellExecutable({
      configuredShell: undefined,
      knownPaths: ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"],
    });

    expect(resolved).toBe("/usr/bin/bash");
  });

  it("throws when no configured/known shell path exists", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() =>
      resolveShellExecutable({
        configuredShell: undefined,
        knownPaths: ["/bin/bash", "/usr/bin/bash"],
      }),
    ).toThrow(/shell/i);
  });
});

describe("spawnCommand", () => {
  it("uses a non-login shell and preserves Pi's inherited environment", () => {
    existsSyncMock.mockImplementation((path) => path === "/bin/bash");
    const child = {} as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);

    expect(spawnCommand("uv run worker.py", "/tmp/project", "/bin/bash")).toBe(
      child,
    );
    expect(spawn).toHaveBeenCalledWith(
      "/bin/bash",
      ["-c", "uv run worker.py"],
      expect.objectContaining({
        cwd: "/tmp/project",
        env: process.env,
        detached: true,
      }),
    );
  });
});
