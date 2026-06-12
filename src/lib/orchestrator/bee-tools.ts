/**
 * Bee tools for the local (Qwen / generic) agent loop.
 *
 * The embedded capability lanes — WebBee (read-only web), BrowserBee
 * (stateful/authenticated browser workflows), and DesktopBee (native desktop
 * automation via the Swift helper) — are exposed here as OpenAI-style function
 * tools so the local executor can invoke them, the same way the Claude harness
 * would. Every call is gated by the ConnectivityPolicy capability matrix first:
 * a tool whose capability is unavailable in the current mode is neither
 * advertised (see `availableBeeTools`) nor dispatched (see `executeBeeTool`).
 *
 * Scope: no new Bee brands (COMPONENT-MAP.md scope wall) — this only wires the
 * three existing lanes into the local tool loop.
 */

import { getConnectivityPolicy, type CapabilityId } from "@/lib/connectivity/policy";
import type { ChatTool } from "./tool-bridge";
import { readToken } from "@/lib/auth/token";

/** Tool name → the connectivity capability that gates it. */
const BEE_TOOL_CAPABILITY: Record<string, CapabilityId> = {
  webbee_search: "webbee",
  browserbee_run: "browserbee",
  desktopbee_action: "desktopbee",
  termbee_session: "termbee",
  termbee_run: "termbee",
};

export const BEE_TOOL_DEFINITIONS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "webbee_search",
      description:
        "WebBee: read-only fresh public-web retrieval with citations. Use for current facts, news, prices, docs, or anything that may have changed recently. Returns an answer plus source citations. Disabled in offline mode.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question or search intent in natural language" },
          freshness: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "How time-sensitive the answer is (default high)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browserbee_run",
      description:
        "BrowserBee: delegate a stateful or authenticated browser workflow (login required, multi-step navigation, form fill, rendered/JS interaction, screenshots). Creates a BrowserBee task that runs on the Codex Computer Use backing path; if no Codex auth is available and the operator enabled the DesktopBee fallback, it instead drives a desktop browser locally via DesktopBee. Use only when WebBee's read-only retrieval is insufficient.",
      parameters: {
        type: "object",
        properties: {
          objective: { type: "string", description: "What to accomplish in the browser" },
          startUrl: { type: "string", description: "The http(s) URL to start from" },
          requiresLogin: { type: "boolean", description: "True if the workflow needs an authenticated session" },
          steps: { type: "array", items: { type: "string" }, description: "Optional ordered steps to follow" },
        },
        required: ["objective", "startUrl"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "desktopbee_action",
      description:
        "DesktopBee: native macOS desktop automation via the Swift helper. Prefer the most reliable strategy first: desktop.script.run (AppleScript/JXA) → desktop.ax.query/desktop.ax.act (Accessibility tree) → desktop.click/desktop.type (coordinates, last resort). Read actions (apps.list, ax.query, capture, permissions) are free; act/script actions run with approval auto-granted by policy.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "desktop.apps.list",
              "desktop.app.launch",
              "desktop.app.activate",
              "desktop.ax.query",
              "desktop.ax.act",
              "desktop.type",
              "desktop.click",
              "desktop.capture",
              "desktop.script.run",
              "desktop.permissions",
            ],
            description: "The DesktopBee action to perform",
          },
          app: { type: "string", description: "Target app bundle id or name, where applicable" },
          params: { type: "object", description: "Action-specific parameters (AX path, coordinates, keystrokes, script text, …)" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termbee_session",
      description:
        "TermBee: manage persistent terminal sessions (real shells that keep their cwd/env across commands). action=create starts a session (optional cwd), list shows sessions, kill ends one. Use a session to run a multi-step build/repo workflow. Available in every connectivity mode (works offline).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "list", "kill"], description: "Session action" },
          sessionId: { type: "string", description: "Session id (for kill; optional for create)" },
          cwd: { type: "string", description: "Working directory for a new session" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termbee_run",
      description:
        "TermBee: run a shell command in a persistent session and get its combined output + exit code. Creates the session on demand if it doesn't exist. State persists between calls (e.g. cd, exported vars).",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session to run in (created if absent)" },
          command: { type: "string", description: "The shell command to run" },
          timeoutMs: { type: "number", description: "Max time to wait (default 120000)" },
        },
        required: ["sessionId", "command"],
      },
    },
  },
];

export function isBeeTool(name: string): boolean {
  return name in BEE_TOOL_CAPABILITY;
}

/**
 * The bee tools that are currently available given the connectivity policy.
 * Only available lanes are advertised to the model so it never reaches for a
 * tool the current mode forbids.
 */
export function availableBeeTools(policy = getConnectivityPolicy()): ChatTool[] {
  return BEE_TOOL_DEFINITIONS.filter((t) => {
    const cap = BEE_TOOL_CAPABILITY[t.function.name];
    return policy.getCapability(cap).available;
  });
}

export interface BeeToolContext {
  projectPath: string;
  project: string;
  requestedBy: string;
}

/** Dispatch a bee tool call. Always enforces the capability gate first. */
export async function executeBeeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BeeToolContext
): Promise<string> {
  const capId = BEE_TOOL_CAPABILITY[name];
  if (!capId) return `Error: Unknown bee tool "${name}"`;

  const cap = getConnectivityPolicy().getCapability(capId);
  if (!cap.available) {
    return `Error: ${name} is unavailable in the current connectivity mode — ${cap.reason ?? "capability disabled"}`;
  }

  switch (name) {
    case "webbee_search":
      return executeWebBeeSearch(args, ctx);
    case "browserbee_run":
      return executeBrowserBeeRun(args, ctx);
    case "desktopbee_action":
      return executeDesktopBeeAction(args);
    case "termbee_session":
      return executeTermBeeSession(args);
    case "termbee_run":
      return executeTermBeeRun(args);
    default:
      return `Error: Unknown bee tool "${name}"`;
  }
}

async function executeTermBeeSession(args: Record<string, unknown>): Promise<string> {
  const { createSession, listSessions, killSession } = await import("@/lib/termbee/session");
  const action = args.action as string;
  if (action === "create") {
    const id = createSession({
      id: typeof args.sessionId === "string" ? args.sessionId : undefined,
      cwd: typeof args.cwd === "string" ? args.cwd : undefined,
    });
    return `TermBee session created: ${id}`;
  }
  if (action === "list") {
    const s = listSessions();
    return s.length ? s.map((x) => `${x.id} (cwd=${x.cwd}, alive=${x.alive})`).join("\n") : "(no sessions)";
  }
  if (action === "kill") {
    const id = typeof args.sessionId === "string" ? args.sessionId : "";
    return killSession(id) ? `Killed ${id}` : `No such session ${id}`;
  }
  return `Error: action must be create | list | kill`;
}

async function executeTermBeeRun(args: Record<string, unknown>): Promise<string> {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  const command = typeof args.command === "string" ? args.command : "";
  if (!sessionId || !command) return "Error: sessionId and command are required";
  const { runCommand } = await import("@/lib/termbee/session");
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
  const r = await runCommand(sessionId, command, timeoutMs);
  const status = r.timedOut ? "(timed out)" : `(exit ${r.exitCode})`;
  return `${r.output}\n${status}`.slice(0, 16_000);
}

async function executeWebBeeSearch(args: Record<string, unknown>, ctx: BeeToolContext): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Error: query is required";
  const freshness = (["low", "medium", "high"].includes(args.freshness as string)
    ? args.freshness
    : "high") as "low" | "medium" | "high";

  const { requestWebBeeAnswer } = await import("@/lib/webbee/client");
  try {
    const res = await requestWebBeeAnswer({ query, requestedBy: ctx.requestedBy, project: ctx.project, freshness });
    if (!res.ok) return `Error: WebBee returned HTTP ${res.status}`;
    const data = await res.json() as import("@/lib/webbee/client").WebBeeAnswerResult;
    if (data.status === "failed") return `WebBee failed: ${data.errorCode ?? "unknown error"}`;
    const cites = data.citations?.length
      ? "\n\nSources:\n" + data.citations.map((c, i) => `[${i + 1}] ${c.title} — ${c.url}`).join("\n")
      : "";
    const esc = data.escalation?.needed ? `\n\n(WebBee suggests escalating to BrowserBee: ${data.escalation.reason ?? ""})` : "";
    return `${data.answer ?? "(no answer)"}${cites}${esc}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: WebBee service unreachable — ${msg}. Is the WebBee lane running (default http://127.0.0.1:4011)?`;
  }
}

async function executeBrowserBeeRun(args: Record<string, unknown>, ctx: BeeToolContext): Promise<string> {
  const {
    parseBrowserBeeJobCreate,
    buildBrowserBeeTaskDescription,
    buildBrowserBeeDesktopFallbackDescription,
    buildBrowserBeeTaskRequestEnvelope,
    resolveBrowserBeeBacking,
    readBrowserBeeDesktopFallbackEnabled,
  } = await import("@/lib/browserbee/contracts");
  const { CODEX_COMPUTER_USE_MODEL_ID } = await import("@/lib/models/catalog");
  const { readCodexAuthState } = await import("@/lib/usage/codex");

  let payload;
  try {
    payload = parseBrowserBeeJobCreate({
      objective: args.objective,
      startUrl: args.startUrl,
      project: ctx.project,
      requestedBy: ctx.requestedBy,
      requiresLogin: args.requiresLogin,
      steps: args.steps,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: invalid BrowserBee request — ${msg}`;
  }

  // Decide which engine drives the browser. Codex Computer Use is preferred;
  // the local DesktopBee path is used only when Codex auth is missing AND the
  // operator opted into the fallback AND DesktopBee is available.
  const desktopBeeAvailable = getConnectivityPolicy().getCapability("desktopbee").available;
  const decision = resolveBrowserBeeBacking({
    codexAuthMode: readCodexAuthState().authMode,
    desktopFallbackEnabled: readBrowserBeeDesktopFallbackEnabled(),
    desktopBeeAvailable,
  });
  if (!decision.backing) return `Error: ${decision.reason}`;

  let model: string;
  let description: string;
  if (decision.backing === "desktop_fallback") {
    const { getLocalModelConfig } = await import("@/lib/config/constants");
    const local = getLocalModelConfig();
    if (!local?.modelName) {
      return "Error: the DesktopBee fallback needs a configured local model (config localModel.modelName), but none is set.";
    }
    model = local.modelName;
    description = buildBrowserBeeDesktopFallbackDescription(payload, { requestedProjectPath: ctx.projectPath });
  } else {
    model = CODEX_COMPUTER_USE_MODEL_ID;
    description = buildBrowserBeeTaskDescription(payload, { requestedProjectPath: ctx.projectPath });
  }

  const envelope = buildBrowserBeeTaskRequestEnvelope(payload, ctx.projectPath, {
    backing: decision.backing,
    backingModel: model,
  });
  const laneLabel = decision.backing === "desktop_fallback" ? "DesktopBee fallback — local model" : "Codex Computer Use";

  // Create the job through the daemon's task API (loopback, shared-secret auth).
  // The task's model selects the executor: Codex Computer Use for the default
  // path, or the local model (which carries the desktopbee_action tool) for the
  // fallback path.
  const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;
  const token = readToken("auth-token") ?? "";
  try {
    const res = await fetch(`${base}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: payload.title,
        description,
        project: payload.project,
        projectPath: ctx.projectPath,
        model,
        status: "backlog",
        executor: "agent",
        source: "browserbee",
        output: { browserbeeRequest: envelope },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Error: failed to create BrowserBee task (HTTP ${res.status})`;
    const task = await res.json() as { _id?: string; title?: string };
    return `Created BrowserBee task ${task._id ?? "?"}: "${task.title ?? payload.title}" (${laneLabel}). It will run the browser workflow and post a summary to its task result.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error creating BrowserBee task: ${msg}`;
  }
}

async function executeDesktopBeeAction(args: Record<string, unknown>): Promise<string> {
  const { dispatchDesktopBeeAction } = await import("@/lib/desktopbee/client");
  const { DESKTOPBEE_ACTIONS } = await import("@/lib/desktopbee/actions");

  const action = args.action as string;
  if (!action || !(DESKTOPBEE_ACTIONS as readonly string[]).includes(action)) {
    return `Error: action must be one of: ${DESKTOPBEE_ACTIONS.join(", ")}`;
  }

  const req = {
    action: action as import("@/lib/desktopbee/actions").DesktopBeeAction,
    app: typeof args.app === "string" ? args.app : undefined,
    params: (args.params && typeof args.params === "object" ? args.params : undefined) as Record<string, unknown> | undefined,
  };

  // Per the configured posture, DesktopBee acts are auto-approved; the helper
  // still enforces its own server-side gate as defence in depth.
  const resp = await dispatchDesktopBeeAction(req, { approved: true });
  if (!resp.ok) return `DesktopBee error: ${resp.error ?? "unknown"}`;
  const strat = resp.strategy ? ` [via ${resp.strategy}]` : "";
  const data = resp.data !== undefined ? `\n${JSON.stringify(resp.data).slice(0, 8_000)}` : "";
  const cap = resp.captureRef ? `\ncapture: ${resp.captureRef}` : "";
  return `DesktopBee ${action} ok${strat}${data}${cap}`;
}
