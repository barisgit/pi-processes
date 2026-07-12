import { ToolBody } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ProcessesDetails } from "../constants";
import type { ProcessManager } from "../manager";
import { executeAction, renderActionCall, renderActionResult } from "./actions";

const DEBUG_PREVIEW_ENABLED = process.env.PI_PROCESSES_DEBUG_PREVIEW === "1";

const PROCESS_ACTIONS = [
  "start",
  "list",
  "output",
  "logs",
  "kill",
  "clear",
  "write",
  ...(DEBUG_PREVIEW_ENABLED ? (["debug_preview"] as const) : []),
] as const;

const ProcessesParams = Type.Object({
  action: StringEnum(PROCESS_ACTIONS, {
    description: DEBUG_PREVIEW_ENABLED
      ? "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin), debug_preview (temporary UI preview, no side effects)"
      : "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin)",
  }),
  command: Type.Optional(
    Type.String({ description: "Command to run (required for start)" }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Friendly name for the process (required for start, e.g. 'backend-dev', 'test-runner')",
    }),
  ),
  id: Type.Optional(
    Type.String({
      description:
        "Process ID, returned by start and list actions (required for output/kill/logs/write)",
    }),
  ),
  input: Type.Optional(
    Type.String({
      description: "Data to write to process stdin (required for write action)",
    }),
  ),
  end: Type.Optional(
    Type.Boolean({
      description:
        "Close stdin after writing (optional for write action, use for programs reading until EOF)",
    }),
  ),
  alertOnSuccess: Type.Optional(
    Type.Boolean({
      description:
        "Get a turn to react when process completes successfully (default: false). Use for builds/tests where you need confirmation.",
    }),
  ),
  alertOnFailure: Type.Optional(
    Type.Boolean({
      description:
        "Get a turn to react when process fails/crashes (default: true). Use to be alerted of unexpected failures.",
    }),
  ),
  alertOnKill: Type.Optional(
    Type.Boolean({
      description:
        "Get a turn to react when process is killed by external signal (default: false). Note: killing via tool never triggers a turn.",
    }),
  ),
  preview: Type.Optional(
    StringEnum(["start", "list", "output", "logs", "error"] as const, {
      description:
        "For action=debug_preview only: which rendered result variant to preview (default: start)",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the command (for start action). Defaults to the session working directory. Prefer this over 'cd dir && command' shell wrappers.",
    }),
  ),
  logWatches: Type.Optional(
    Type.Array(
      Type.Object(
        {
          pattern: Type.String({
            description:
              "Regular expression pattern to match against process output lines",
          }),
          stream: Type.Optional(
            StringEnum(["stdout", "stderr", "both"] as const, {
              description:
                "Which stream to watch (default: both). Use stdout/stderr to reduce noise.",
            }),
          ),
          repeat: Type.Optional(
            Type.Boolean({
              description:
                "Trigger every time this pattern matches (default: false, one-time)",
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  ),
});

type ProcessesParamsType = Static<typeof ProcessesParams>;

export function setupProcessesTools(pi: ExtensionAPI, manager: ProcessManager) {
  pi.registerTool<typeof ProcessesParams, ProcessesDetails>({
    name: "process",
    label: "Process",
    description: `Manage long-running commands in the background. Start a named command, then list it, inspect recent output or log files, write to stdin, kill it, or clear finished entries. Process status remains visible to the user; alert flags and log watches only control when Pi gives you a follow-up turn. Notifications remove the need to poll.`,
    promptSnippet:
      "Manage background processes without blocking the conversation",

    parameters: ProcessesParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAction(params, manager, ctx);
    },

    renderCall(args: ProcessesParamsType, theme: Theme, _context) {
      return renderActionCall(args, theme);
    },

    renderResult(
      result: AgentToolResult<ProcessesDetails>,
      options: ToolRenderResultOptions,
      theme: Theme,
      _context,
    ) {
      if (options.isPartial) {
        return new Text(theme.fg("muted", "Process: running..."), 0, 0);
      }

      const { details } = result;

      // Framework sets details to {} when tool throws.
      // Detect by checking for missing expected fields.
      if (!details?.action) {
        const textBlock = result.content.find((c) => c.type === "text");
        const errorMsg =
          (textBlock?.type === "text" && textBlock.text) ||
          "Tool execution failed";
        return new Text(theme.fg("error", errorMsg), 0, 0);
      }

      if (!details.success) {
        return new ToolBody(
          {
            fields: [
              {
                label: "Error",
                value: theme.fg("error", details.message),
                showCollapsed: true,
              },
            ],
          },
          options,
          theme,
        );
      }

      return renderActionResult(result, options, theme);
    },
  });
}
