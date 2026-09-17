import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ManagerEvent } from "./constants";
import { ProcessManager } from "./manager";

// SessionManager object identity isolates SDK children, including sessions opened
// from the same file. The session ID separates new/resume/fork on that host.
const registryKey = Symbol.for("@aliou/pi-processes/session-managers/v1");
type Registry = Map<
  ExtensionContext["sessionManager"],
  Map<string, ProcessManager>
>;
const host = globalThis as typeof globalThis & { [registryKey]?: Registry };
host[registryKey] ??= new Map();
const registry = host[registryKey];

export function bindSessionManager(
  pi: ExtensionAPI,
  getShell: () => string | undefined,
) {
  let active: ProcessManager | undefined;
  let owner: ExtensionContext["sessionManager"] | undefined;
  let sessionId: string | undefined;
  const listeners = new Map<
    (event: ManagerEvent) => void,
    (() => void) | undefined
  >();

  const detach = () => {
    for (const [listener, off] of listeners) {
      off?.();
      listeners.set(listener, undefined);
    }
    active = undefined;
  };

  pi.on("session_start", (_event, ctx) => {
    detach();
    owner = ctx.sessionManager;
    sessionId = owner.getSessionId();
    let sessions = registry.get(owner);
    if (!sessions) {
      sessions = new Map();
      registry.set(owner, sessions);
    }
    active = sessions.get(sessionId);
    if (!active) {
      active = new ProcessManager();
      sessions.set(sessionId, active);
    }
    active.setConfiguredShellPath(getShell);
    for (const listener of listeners.keys())
      listeners.set(listener, active.onEvent(listener));
    active.resumeNotifications();
  });

  // Commands/tools register before session_start, but resolve the live core at
  // call time. Subscription ownership belongs to this activation, not the core.
  const manager = new Proxy({} as ProcessManager, {
    get(_target, property) {
      if (property === "onEvent") {
        return (listener: (event: ManagerEvent) => void) => {
          listeners.set(listener, active?.onEvent(listener));
          return () => {
            listeners.get(listener)?.();
            listeners.delete(listener);
          };
        };
      }
      if (!active) throw new Error("Process manager is not bound to a session");
      const value = Reflect.get(active, property);
      return typeof value === "function" ? value.bind(active) : value;
    },
  });

  return {
    manager,
    // Register AFTER cleanup/widget hooks: their shutdown still needs the core.
    finishSetup() {
      pi.on("session_shutdown", (event) => {
        if (event.reason === "reload") active?.deferNotifications();
        if (
          event.reason !== "reload" &&
          active?.list().length === 0 &&
          owner &&
          sessionId
        ) {
          const sessions = registry.get(owner);
          sessions?.delete(sessionId);
          if (sessions?.size === 0) registry.delete(owner);
        }
        detach();
      });
    },
  };
}
