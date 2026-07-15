import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedProcessesConfig } from "../../config";
import { setupProcessWidget } from "./setup";

const utilsMocks = vi.hoisted(() => ({
  connect: vi.fn(),
}));

vi.mock("pi-extension-utils", () => ({
  connect: utilsMocks.connect,
}));

vi.mock("../../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config")>()),
  configLoader: {
    getConfig: () => ({ widget: { showStatusWidget: false } }),
  },
}));

describe("setupProcessWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disposes the previous log dock when the widget host recreates it", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const widgetFactories = new Map<string, (...args: never[]) => unknown>();
    const widgets = {
      set: vi.fn(
        (
          _placement: string,
          key: string,
          factory: (...args: never[]) => unknown,
        ) => {
          widgetFactories.set(key, factory);
        },
      ),
      remove: vi.fn(),
    };
    utilsMocks.connect.mockReturnValue({
      widgets,
      dispose: vi.fn(),
    });

    const unsubscribers: ReturnType<typeof vi.fn>[] = [];
    const manager = {
      list: vi.fn(() => []),
      onEvent: vi.fn(() => {
        const unsubscribe = vi.fn();
        unsubscribers.push(unsubscribe);
        return unsubscribe;
      }),
    };
    const pi = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
      }),
    };
    const config = {
      widget: { dockHeight: 12 },
      follow: { enabledByDefault: true, autoHideOnFinish: true },
    } as ResolvedProcessesConfig;

    const { dockActions } = setupProcessWidget(
      pi as never,
      manager as never,
      config,
    );
    const ctx = {
      hasUI: true,
      ui: { theme: {} },
    };
    await handlers.get("session_start")?.({}, ctx);
    dockActions.expand();

    const factory = widgetFactories.get("processes-dock");
    expect(factory).toBeDefined();
    factory?.({ requestRender: vi.fn() } as never, {} as never);
    factory?.({ requestRender: vi.fn() } as never, {} as never);

    expect(unsubscribers).toHaveLength(3);
    expect(unsubscribers[1]).toHaveBeenCalledOnce();
    expect(unsubscribers[2]).not.toHaveBeenCalled();
  });
});
