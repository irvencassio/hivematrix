/**
 * Lane tools for the local (Qwen / generic) agent loop.
 *
 * The embedded capability lanes — Browser Lane (read-only web plus
 * stateful/authenticated browser workflows) and Desktop Lane (native desktop
 * automation via the Swift helper) — are exposed here as OpenAI-style function
 * tools so the local executor can invoke them, the same way the Claude harness
 * would. Every call is gated by the ConnectivityPolicy capability matrix first:
 * a tool whose capability is unavailable in the current mode is neither
 * advertised (see `availableLaneTools`) nor dispatched (see `executeLaneTool`).
 *
 * Naming: tools are advertised under lane-native ids (desktop_action,
 * terminal_run, mail_send, …). Legacy bee-branded ids are still accepted on
 * dispatch via LANE_TOOL_ALIASES but never advertised; the removed browser ids
 * (webbee_search/browserbee_run) are rejected outright.
 */

import { getConnectivityPolicy, type CapabilityId } from "@/lib/connectivity/policy";
import type { ChatTool } from "./tool-bridge";
import { readToken } from "@/lib/auth/token";
import { defaultTermBeeProvider } from "@/lib/termbee/provider";
import type { CooDispatchResult } from "@/lib/coo/dispatch";

/** Tool name → the connectivity capability that gates it. */
const LANE_TOOL_CAPABILITY: Record<string, CapabilityId> = {
  coo_dispatch: "coo_router",
  hivematrix_browser: "browserbee",
  desktop_action: "desktopbee",
  terminal_session: "termbee",
  terminal_run: "termbee",
  mail_send: "mailbee",
  mail_draft: "mailbee",
  message_send: "messagebee",
  brain_search: "brain",
  skill_used: "brain",
  digest_url: "webbee",
  code_graph: "codegraph",
};

/**
 * Legacy bee-branded tool ids → the lane-native name that now owns the handler.
 *
 * The Bee→Lane rename flipped the *advertised* tool names (LANE_TOOL_DEFINITIONS)
 * to lane-native ids. These aliases keep older callers working: a persisted tool
 * call or a frontier harness that still emits `mailbee_send` (or POSTs
 * `/bee/mailbee_send`) resolves to the lane handler. Removing the legacy ids is a
 * later migration once nothing emits them. (The browser tool is `hivematrix_browser`;
 * its removed legacy ids `webbee_search`/`browserbee_run` stay rejected.)
 */
const LANE_TOOL_ALIASES: Record<string, string> = {
  desktopbee_action: "desktop_action",
  termbee_session: "terminal_session",
  termbee_run: "terminal_run",
  mailbee_send: "mail_send",
  mailbee_draft: "mail_draft",
  messagebee_send: "message_send",
};

/** Resolve an incoming tool name to its canonical handler name (or itself). */
export function resolveLaneToolName(name: string): string {
  return LANE_TOOL_ALIASES[name] ?? name;
}

export const LANE_TOOL_DEFINITIONS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "coo_dispatch",
      description:
        "COO router: route a browser/site/workflow request through the operator's COO routing rules instead of guessing a lane. Use this when a request should be handled by an authenticated or multi-step browser workflow and you want it routed by policy — Browser Lane is the canonical browser automation path. Prepare-only by default (returns the matched rule, lane, capability, and a Browser-Lane-ready plan). Set create=true to create the routed Browser Lane task and get its taskId. Only browser routes execute here; mail/message/desktop/terminal routes return approval_required and never act. Returns a structured status: prepared | created | no_match | needs_input | approval_required | unsupported.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The objective / request to route (natural language)" },
          domains: { type: "array", items: { type: "string" }, description: "Target site domain(s); the first becomes the Browser Lane start URL" },
          project: { type: "string", description: "Optional project label for the routed work" },
          create: { type: "boolean", description: "True to create the routed Browser Lane task (browser routes only); default false = prepare-only" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hivematrix_browser",
      description:
        "Browser Lane: use this single browser tool for live web research, page reading, and logged-in or multi-step browser workflows. Modes search/read are read-only and should return citations; modes open/snapshot/workflow use the Browser Lane app/session layer for rendered pages, uploads, authenticated sites, screenshots, and human-required auth checkpoints. Prefer this over Chrome MCP/browser extensions unless the operator explicitly routes elsewhere.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["search", "read", "open", "snapshot", "workflow"],
            description: "search/read for public web, open/snapshot/workflow for rendered or authenticated browser work",
          },
          query: { type: "string", description: "The question or search intent for search/read modes" },
          url: { type: "string", description: "The page URL for read/open/snapshot modes" },
          objective: { type: "string", description: "What to accomplish for workflow mode" },
          startUrl: { type: "string", description: "The http(s) URL to start from for workflow mode" },
          requiresLogin: { type: "boolean", description: "True if the workflow needs an authenticated session" },
          steps: { type: "array", items: { type: "string" }, description: "Optional ordered steps to follow" },
          freshness: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "How time-sensitive the answer is (default high)",
          },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "desktop_action",
      description:
        "Desktop Lane: native macOS desktop automation via the Swift helper. Prefer the most reliable strategy first: desktop.script.run (AppleScript/JXA) → desktop.ax.query/desktop.ax.act (Accessibility tree) → desktop.click/desktop.type (coordinates, last resort). Read actions (apps.list, ax.query, capture, permissions) are free; act/script actions run with approval auto-granted by policy.",
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
            description: "The Desktop Lane action to perform",
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
      name: "terminal_session",
      description:
        "Terminal Lane: manage Canopy-backed persistent terminal sessions when Canopy is available, with a local shell fallback for local work. action=create starts a session (optional cwd), list shows sessions, kill ends local fallback sessions. Use a session to run a multi-step build/repo workflow without passing credentials through tool args.",
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
      name: "terminal_run",
      description:
        "Terminal Lane: run a shell command in a Canopy-backed persistent session when Canopy is available, returning combined output + exit code; falls back to a local shell only when Canopy is unavailable. Creates the session on demand if it doesn't exist. Do not pass passwords or secrets in commands/tool args.",
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
  {
    type: "function",
    function: {
      name: "mail_send",
      description:
        "Mail Lane: send an email through Apple Mail — including file attachments. This is the ONLY correct way to send email; do NOT use bash/osascript, a Gmail/Google integration, or any other interface, and never ask the user to authenticate an external mail account. Safe by default: the email is sent only if the recipient is on the trusted allowlist (a known sender or a configured trusted domain); otherwise it is saved as a draft in Mail for human approval and NOT sent. Returns whether it was sent or drafted.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Plain-text email body" },
          attachments: { type: "array", items: { type: "string" }, description: "Optional absolute file paths to attach (e.g. images/docs on this machine)" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mail_draft",
      description:
        "Mail Lane: compose an email (with optional file attachments) and save it to the Mail Drafts folder for human review (never sends). Use when you want a person to approve/edit before it goes out, regardless of recipient trust.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Plain-text email body" },
          attachments: { type: "array", items: { type: "string" }, description: "Optional absolute file paths to attach" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "message_send",
      description:
        "Message Lane: send an SMS/iMessage through the macOS Messages app. This is the ONLY correct way to send a text — do not use bash/osascript. Safe by default: messages are sent only to allowlisted recipients; a non-allowlisted handle is refused with an actionable error.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient handle — phone number (E.164, e.g. +14155551234) or iMessage email" },
          text: { type: "string", description: "The message text to send" },
        },
        required: ["to", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "brain_search",
      description:
        "Brain: search durable memory (the brain docs / knowledge base stored under the brain root) for documents relevant to a query. ALWAYS use this before answering questions about projects, decisions, or prior work — the operator's context lives here, not just in the conversation. Recall things written down earlier (past decisions, analyses, playbooks, runbooks, references) instead of assuming they aren't available. Returns the top matching docs with a relevance score and a snippet; read the full file (read_file) for detail.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What you're looking for, in natural language or keywords" },
          maxResults: { type: "number", description: "How many docs to return (default 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill_used",
      description:
        "Skill library: record that you applied a skill from the library to this task, so it earns its keep and improves. Call this AFTER following a skill. If you found a better way or a gotcha, include a one-line 'refinement' and it gets appended to the skill for next time.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The skill name (as shown in the skill library index)" },
          refinement: { type: "string", description: "Optional: a one-line improvement or gotcha to fold into the skill" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "digest_url",
      description:
        "Digest a web link for later review: spawns a task that fetches the page, summarizes it, and saves a markdown brain doc with the summary + source link. Use when you encounter a link worth saving to the knowledge base (e.g. an article in an email).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http(s) URL to digest" },
          note: { type: "string", description: "Optional note/context to fold into the digest" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_graph",
      description:
        "Deterministic code intelligence: find exactly where a symbol (function/class/type/variable) is DEFINED and EVERY place it is REFERENCED across a project, via an exact word-boundary search + definition classification. Use this for precise navigation and — critically — to VERIFY you found every usage of a symbol you changed (don't trust semantic similarity for that). Complements brain_search; works offline.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "The identifier to look up (function/class/type/var name)" },
          path: { type: "string", description: "Project root to search (defaults to the task's project path)" },
        },
        required: ["symbol"],
      },
    },
  },
];

export function isLaneTool(name: string): boolean {
  return resolveLaneToolName(name) in LANE_TOOL_CAPABILITY;
}

/**
 * The bee tools that are currently available given the connectivity policy.
 * Only available lanes are advertised to the model so it never reaches for a
 * tool the current mode forbids.
 */
export function availableLaneTools(policy = getConnectivityPolicy()): ChatTool[] {
  return LANE_TOOL_DEFINITIONS.filter((t) => {
    const cap = LANE_TOOL_CAPABILITY[t.function.name];
    return policy.getCapability(cap).available;
  });
}

/** Intent → tool mapping, shown for one available lane. */
const CAPABILITY_ROUTING_LINES: Record<string, string> = {
  coo_dispatch: "Route a browser/site/workflow request through COO routing rules (Browser Lane is the canonical browser automation path) → **coo_dispatch**. Routing + prepare work in every mode; create=true makes the routed Browser Lane task when browser execution is available, otherwise it reports the work is waiting for connectivity (it never silently reroutes). When the request matches a registered workflow (e.g. the HeyGen portal video), the result names the workflow id + runbook.",
  mail_send: "Send an email → **mail_send** (sends to trusted recipients; drafts for approval otherwise). Save a draft only → **mail_draft**.",
  message_send: "Send an SMS / iMessage → **message_send** (allowlisted recipients only).",
  hivematrix_browser: "Read/search the live web or drive logged-in/multi-step browser workflows → **hivematrix_browser**.",
  desktop_action: "Control a native macOS app → **desktop_action**.",
  terminal_run: "Run shell commands in a Canopy-backed persistent terminal with local fallback → **terminal_run**.",
  brain_search: "Recall a stored document / brain doc / past decision → **brain_search** (search durable memory before assuming it isn't written down).",
  code_graph: "Find where a symbol is defined + every place it's used → **code_graph** (exact, deterministic — use it to verify you found ALL usages of anything you changed, not just the obvious ones).",
};

/**
 * The "chief of staff" routing table injected into the agent's system prompt.
 * Tells the agent which named tool owns each intent so it dispatches to the
 * right capability lane instead of improvising with bash/osascript or its own
 * built-in interfaces. Only lanes available in the current connectivity mode are
 * listed, so the guidance never points at a tool the agent can't call.
 */
export function capabilityRoutingGuide(policy = getConnectivityPolicy()): string {
  const available = new Set(availableLaneTools(policy).map((t) => t.function.name));
  const lines: string[] = [];
  for (const [tool, text] of Object.entries(CAPABILITY_ROUTING_LINES)) {
    if (available.has(tool)) lines.push(`- ${text}`);
  }
  if (lines.length === 0) return "";
  return [
    "--- Capability Routing (use these tools; do not improvise) ---",
    "When a task needs one of these actions you MUST use the named tool rather than bash/osascript or your own built-in interfaces:",
    ...lines,
    "Only the capabilities available in the current connectivity mode are listed above and present in your tool set. If you need one that isn't listed, say so plainly instead of working around it.",
  ].join("\n");
}

export interface LaneToolContext {
  projectPath: string;
  project: string;
  requestedBy: string;
}

/** Dispatch a bee tool call. Always enforces the capability gate first. */
export async function executeLaneTool(
  rawName: string,
  args: Record<string, unknown>,
  ctx: LaneToolContext
): Promise<string> {
  // Accept lane-native and legacy aliases, dispatching on the canonical name.
  const name = resolveLaneToolName(rawName);
  const capId = LANE_TOOL_CAPABILITY[name];
  if (!capId) return `Error: Unknown lane tool "${rawName}"`;

  const cap = getConnectivityPolicy().getCapability(capId);
  if (!cap.available) {
    return `Error: ${name} is unavailable in the current connectivity mode — ${cap.reason ?? "capability disabled"}`;
  }

  switch (name) {
    case "coo_dispatch":
      return executeCooDispatch(args, ctx);
    case "hivematrix_browser":
      return executeBrowserLane(args, ctx);
    case "desktop_action":
      return executeDesktopBeeAction(args);
    case "terminal_session":
      return executeTermBeeSession(args);
    case "terminal_run":
      return executeTermBeeRun(args);
    case "mail_send":
      return executeMailBeeSend(args);
    case "mail_draft":
      return executeMailBeeDraft(args);
    case "message_send":
      return executeMessageBeeSend(args);
    case "brain_search":
      return executeBrainSearch(args);
    case "skill_used":
      return executeSkillUsed(args);
    case "digest_url":
      return executeDigestUrl(args);
    case "code_graph":
      return executeCodeGraph(args, ctx);
    default:
      return `Error: Unknown lane tool "${name}"`;
  }
}

// ── COO dispatch (router) ─────────────────────────────────────────────────────
//
// The model-facing entry to COO route-to-execution. It does NOT re-implement
// routing — it calls the daemon's /coo/dispatch endpoint (which wraps
// dispatchCooTask), so rules, approval posture, redaction, and task creation stay
// in one place. Browser Lane is the canonical browser automation path; only
// browser routes create a task here.

export interface CooDispatchToolBody {
  text: string;
  domains?: string[];
  project?: string | null;
  create?: boolean;
  projectPath?: string | null;
}

export type CooDispatchToolRunner = (body: CooDispatchToolBody) => Promise<CooDispatchResult>;

function readDomainsArg(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Default runner: loopback to the daemon's /coo/dispatch (single source of truth). */
async function loopbackCooDispatch(body: CooDispatchToolBody): Promise<CooDispatchResult> {
  const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;
  const token = readToken("auth-token") ?? "";
  const res = await fetch(`${base}/coo/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok?: boolean; result?: CooDispatchResult; error?: string };
  if (!data.ok || !data.result) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.result;
}

/** Render a dispatch result as a concise, secret-free model-facing string. */
export function formatCooDispatchResult(result: CooDispatchResult): string {
  const lane = result.lane ?? "—";
  const cap = result.capability && result.capability !== "—" ? ` · ${result.capability}` : "";
  const ruleName = result.route?.ruleName ? ` (rule "${result.route.ruleName}")` : "";
  const lines = [`COO dispatch [${result.status}] → lane ${lane}${cap}${ruleName}`];
  if (result.reason) lines.push(result.reason);
  if (result.status === "created" && result.taskId) {
    lines.push(`Created Browser Lane task ${result.taskId} — it runs on the board and its result appears as it completes.`);
  }
  if (result.status === "execution_unavailable") {
    lines.push("Routing worked, but lane execution is unavailable right now — no task was queued. It waits for connectivity; nothing was silently rerouted.");
  }
  if (result.status === "readiness_required") {
    lines.push("Routing worked, but the target site's auth/readiness needs attention — no task was made. Resolve the site's readiness, then retry.");
  }
  // Surface site readiness (metadata only) whenever it was evaluated.
  if (result.readiness) {
    const r = result.readiness;
    if (r.matched) {
      const trace = r.traceRunId ? `, trace ${r.traceRunId}` : "";
      lines.push(`Site readiness: ${r.siteName ?? r.siteId} — ${r.status} (${r.color})${r.acceptable ? "" : " — needs attention"}${trace}.`);
    } else if (r.requiresLogin) {
      lines.push("Site readiness: no configured Browser Lane site matches this target — auth can't be confirmed for an authenticated workflow.");
    }
  }
  if (result.status === "approval_required" && result.approval) {
    lines.push(`Approval required (no action taken): ${result.approval.trust}`);
  }
  if (result.workflow) {
    lines.push(`Registered workflow: ${result.workflow.id} — runbook ${result.workflow.runbook}.`);
  }
  if (result.auditId) lines.push(`auditId: ${result.auditId}`);
  return lines.join("\n");
}

export async function executeCooDispatch(
  args: Record<string, unknown>,
  ctx: LaneToolContext,
  runner: CooDispatchToolRunner = loopbackCooDispatch,
): Promise<string> {
  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text) return "Error: 'text' (the objective/request to route) is required for coo_dispatch.";
  const create = args.create === true;
  const project = typeof args.project === "string" && args.project.trim() ? args.project.trim() : ctx.project;
  try {
    const result = await runner({
      text,
      domains: readDomainsArg(args.domains),
      project,
      create,
      // A real task needs a real project root — use the task's own project path.
      projectPath: create ? ctx.projectPath : undefined,
    });
    return formatCooDispatchResult(result);
  } catch (err) {
    return `Error: COO dispatch failed — ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function executeCodeGraph(args: Record<string, unknown>, ctx: LaneToolContext): Promise<string> {
  const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
  if (!symbol) return "Error: 'symbol' is required for code_graph.";
  const root = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ctx.projectPath;
  const { findSymbol } = await import("@/lib/codegraph/provider");
  const { formatSymbolGraph } = await import("@/lib/codegraph/contracts");
  return formatSymbolGraph(await findSymbol(symbol, root));
}

async function executeDigestUrl(args: Record<string, unknown>): Promise<string> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return "Error: 'url' is required for digest_url.";
  const note = typeof args.note === "string" ? args.note : undefined;
  const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;
  const token = readToken("auth-token") ?? "";
  try {
    const res = await fetch(`${base}/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, note }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Error: failed to create digest task (HTTP ${res.status})`;
    const data = await res.json() as { docPath?: string };
    return `Created a digest task for ${url} — it will fetch + summarize the page and save a brain doc${data.docPath ? ` at ${data.docPath}` : ""}.`;
  } catch (err) {
    return `Error creating digest task: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function executeBrainSearch(args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Error: 'query' is required for brain_search.";
  const maxResults = typeof args.maxResults === "number" && args.maxResults > 0 ? Math.min(args.maxResults, 20) : undefined;
  const { formatBrainSearchResult } = await import("@/lib/brain/search");
  const { isEmbeddingsEnabled } = await import("@/lib/embeddings/provider");
  if (isEmbeddingsEnabled()) {
    const { hybridBrainSearch } = await import("@/lib/embeddings/search");
    return formatBrainSearchResult(await hybridBrainSearch(query, { maxResults }));
  }
  const { searchBrain } = await import("@/lib/brain/search");
  return formatBrainSearchResult(await searchBrain(query, { maxResults }));
}

async function executeSkillUsed(args: Record<string, unknown>): Promise<string> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return "Error: 'name' (the skill name) is required for skill_used.";
  const refinement = typeof args.refinement === "string" ? args.refinement.trim() : undefined;
  const { markSkillUsed } = await import("@/lib/skills/store");
  const r = await markSkillUsed(name, { refinement });
  if (!r.ok) return `Error: no skill named "${name}" in the library (nothing recorded).`;
  return `Recorded use of "${name}" (used ${r.useCount}×)${r.refined ? " and folded in your refinement." : "."}`;
}

// ── Outbound channel lanes (Mail Lane / Message Lane) ─────────────────────────
//
// These actually act on the founder's behalf, so the safety boundary lives
// inside the tool, not in the profile: Mail Lane sends only to trusted
// recipients (else it drafts for approval), Message Lane sends only to
// allowlisted handles.
// The IO is injectable so the trust/allowlist decision is unit-testable without
// a live database or Apple Mail/Messages.

export interface MailBeeSendIO {
  /** True when the recipient is a known sender or sits on a configured trusted domain. */
  isTrustedRecipient(to: string): boolean;
  sendMail(to: string, subject: string, body: string, attachments?: string[]): Promise<boolean>;
  draftMail(to: string, subject: string, body: string, attachments?: string[]): Promise<boolean>;
}

/** Read `attachments` from tool args — an array of paths, or a comma/newline list. */
export function readAttachments(args: Record<string, unknown>): string[] {
  const a = args.attachments ?? args.attachment;
  let list: string[] = [];
  if (Array.isArray(a)) list = a.filter((x): x is string => typeof x === "string");
  else if (typeof a === "string") list = a.split(/[\n,]+/);
  return list.map((s) => s.trim()).filter(Boolean);
}

async function defaultMailBeeIO(): Promise<MailBeeSendIO> {
  const store = await import("@/lib/mailbee/store");
  const mail = await import("@/lib/mailbee/applemail");
  return {
    isTrustedRecipient: (to) => store.isKnownSender(to) || store.isAuthenticatedDomain(to),
    sendMail: mail.sendMail,
    draftMail: mail.draftMail,
  };
}

function readStringArgs(args: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = typeof args[k] === "string" ? (args[k] as string).trim() : "";
  return out;
}

export async function executeMailBeeSend(args: Record<string, unknown>, io?: MailBeeSendIO): Promise<string> {
  const { to, subject, body } = readStringArgs(args, ["to", "subject", "body"]);
  if (!to || !body) return "Error: 'to' and 'body' are required to send an email.";
  const attachments = readAttachments(args);
  const att = attachments.length ? ` with ${attachments.length} attachment(s)` : "";
  const deps = io ?? (await defaultMailBeeIO());

  if (!deps.isTrustedRecipient(to)) {
    const drafted = await deps.draftMail(to, subject, body, attachments);
    return drafted
      ? `Recipient ${to} is not on the Mail Lane trusted allowlist, so the email was NOT sent — it was saved to Mail Drafts${att} for your approval. Approve/edit it in Mail.app, or add ${to} (or its domain) to the Mail Lane allowlist to enable autonomous send.`
      : `Error: ${to} is not trusted and saving the draft to Mail failed. Is Mail.app running with Automation permission granted?`;
  }

  const sent = await deps.sendMail(to, subject, body, attachments);
  return sent
    ? `Email sent to ${to} via Apple Mail${att} (recipient is on the trusted allowlist).`
    : `Error: sending the email to ${to} failed. Is Mail.app running with Automation permission granted?`;
}

export async function executeMailBeeDraft(args: Record<string, unknown>, io?: MailBeeSendIO): Promise<string> {
  const { to, subject, body } = readStringArgs(args, ["to", "subject", "body"]);
  if (!to || !body) return "Error: 'to' and 'body' are required to draft an email.";
  const attachments = readAttachments(args);
  const att = attachments.length ? ` with ${attachments.length} attachment(s)` : "";
  const deps = io ?? (await defaultMailBeeIO());
  const drafted = await deps.draftMail(to, subject, body, attachments);
  return drafted
    ? `Draft saved to Mail Drafts for ${to}${att} — review and send it from Mail.app when ready.`
    : `Error: saving the draft to Mail failed. Is Mail.app running with Automation permission granted?`;
}

export interface MessageBeeSendIO {
  isAllowed(handle: string): boolean;
  sendIMessage(handle: string, text: string, attachments?: string[]): Promise<boolean>;
  recordOutbound(): void;
}

async function defaultMessageBeeIO(): Promise<MessageBeeSendIO> {
  const store = await import("@/lib/messagebee/store");
  const im = await import("@/lib/messagebee/imessage");
  return {
    isAllowed: store.isAllowed,
    sendIMessage: im.sendIMessage,
    recordOutbound: store.recordOutbound,
  };
}

export async function executeMessageBeeSend(args: Record<string, unknown>, io?: MessageBeeSendIO): Promise<string> {
  const to = typeof args.to === "string" ? args.to.trim() : "";
  const text = typeof args.text === "string" ? args.text.trim() : "";
  const attachments = readAttachments(args);
  if (!to || (!text && attachments.length === 0)) {
    return "Error: 'to' and either 'text' or an attachment are required to send a message.";
  }
  const deps = io ?? (await defaultMessageBeeIO());

  if (!deps.isAllowed(to)) {
    return `Error: ${to} is not on the Message Lane allowlist. SMS/iMessage can only be sent to allowlisted handles — add ${to} in Message Lane settings first, then retry.`;
  }

  const sent = await deps.sendIMessage(to, text, attachments);
  if (sent) deps.recordOutbound();
  const what = attachments.length ? `Message (with ${attachments.length} attachment(s))` : "Message";
  return sent
    ? `${what} sent to ${to} via Messages.`
    : `Error: sending the message to ${to} failed. Is Messages signed in and the handle reachable via iMessage?`;
}

async function executeTermBeeSession(args: Record<string, unknown>): Promise<string> {
  const action = args.action as string;
  if (action === "create") {
    const id = await defaultTermBeeProvider.createSession({
      id: typeof args.sessionId === "string" ? args.sessionId : undefined,
      cwd: typeof args.cwd === "string" ? args.cwd : undefined,
    });
    return `Terminal Lane session created: ${id}`;
  }
  if (action === "list") {
    const s = await defaultTermBeeProvider.listSessions();
    return s.length ? s.map((x) => `${x.id} (cwd=${x.cwd}, alive=${x.alive})`).join("\n") : "(no sessions)";
  }
  if (action === "kill") {
    const id = typeof args.sessionId === "string" ? args.sessionId : "";
    return await defaultTermBeeProvider.killSession(id) ? `Killed ${id}` : `No such local fallback session ${id}`;
  }
  return `Error: action must be create | list | kill`;
}

async function executeTermBeeRun(args: Record<string, unknown>): Promise<string> {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  const command = typeof args.command === "string" ? args.command : "";
  if (!sessionId || !command) return "Error: sessionId and command are required";
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
  const r = await defaultTermBeeProvider.runCommand(sessionId, command, timeoutMs);
  const status = r.timedOut ? "(timed out)" : `(exit ${r.exitCode})`;
  return `${r.output}\n${status}`.slice(0, 16_000);
}

async function executeBrowserLaneRead(args: Record<string, unknown>, ctx: LaneToolContext): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Error: query is required";
  const freshness = (["low", "medium", "high"].includes(args.freshness as string)
    ? args.freshness
    : "high") as "low" | "medium" | "high";

  const { requestBrowserLaneRead } = await import("@/lib/browser-lane/read-client");
  try {
    const res = await requestBrowserLaneRead({ query, requestedBy: ctx.requestedBy, project: ctx.project, freshness });
    if (!res.ok) return `Error: Browser Lane returned HTTP ${res.status}`;
    const data = await res.json() as import("@/lib/browser-lane/read-client").BrowserLaneReadResult;
    if (data.status === "failed") return `Browser Lane failed: ${data.errorCode ?? "unknown error"}`;
    const cites = data.citations?.length
      ? "\n\nSources:\n" + data.citations.map((c, i) => `[${i + 1}] ${c.title} — ${c.url}`).join("\n")
      : "";
    const esc = data.escalation?.needed ? `\n\n(Browser Lane suggests a rendered/authenticated workflow: ${data.escalation.reason ?? ""})` : "";
    return `${data.answer ?? "(no answer)"}${cites}${esc}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: Browser Lane read service unreachable — ${msg}. Is the Browser Lane read backend running (default http://127.0.0.1:4011)?`;
  }
}

async function executeBrowserLane(args: Record<string, unknown>, ctx: LaneToolContext): Promise<string> {
  const mode = typeof args.mode === "string" ? args.mode.trim() : "";
  if (mode === "search" || mode === "read") {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    const prompt = typeof args.query === "string" ? args.query.trim() : "";
    const query = url
      ? prompt
        ? `Read ${url} and answer: ${prompt}`
        : `Read and summarize ${url}`
      : prompt;
    return executeBrowserLaneRead({ ...args, query }, ctx);
  }
  if (mode === "open" || mode === "snapshot" || mode === "workflow") {
    return executeBrowserBeeRun({
      ...args,
      objective: typeof args.objective === "string" && args.objective.trim()
        ? args.objective
        : `Open ${typeof args.url === "string" ? args.url : args.startUrl ?? "the requested page"}`,
      startUrl: typeof args.startUrl === "string" && args.startUrl.trim()
        ? args.startUrl
        : args.url,
    }, ctx);
  }
  return "Error: mode must be search | read | open | snapshot | workflow";
}

async function executeBrowserBeeRun(args: Record<string, unknown>, ctx: LaneToolContext): Promise<string> {
  const {
    parseBrowserBeeJobCreate,
    buildBrowserBeeTaskDescription,
    buildBrowserBeeDesktopFallbackDescription,
    buildBrowserBeeTaskRequestEnvelope,
    resolveBrowserBeeBacking,
    readBrowserBeeDesktopFallbackEnabled,
  } = await import("@/lib/browser-lane/jobs");
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
    return `Error: invalid Browser Lane request — ${msg}`;
  }

  // Decide which engine drives the browser. Codex Computer Use is preferred;
  // the local Desktop Lane path is used only when Codex auth is missing AND the
  // operator opted into the fallback AND Desktop Lane is available.
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
      return "Error: the Desktop Lane fallback needs a configured local model (config localModel.modelName), but none is set.";
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
  const laneLabel = decision.backing === "desktop_fallback" ? "Desktop fallback — local model" : "Codex Computer Use";

  // Create the job through the daemon's task API (loopback, shared-secret auth).
  // The task's model selects the executor: Codex Computer Use for the default
  // path, or the local model (which carries the desktop_action tool) for the
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
        source: "browser-lane",
        output: { browserbeeRequest: envelope },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Error: failed to create Browser Lane task (HTTP ${res.status})`;
    const task = await res.json() as { _id?: string; title?: string };
    return `Created Browser Lane task ${task._id ?? "?"}: "${task.title ?? payload.title}" (${laneLabel}). It runs independently; its result appears on the board as that task completes.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error creating Browser Lane task: ${msg}`;
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

  // Per the configured posture, Desktop Lane acts are auto-approved; the helper
  // still enforces its own server-side gate as defence in depth.
  const resp = await dispatchDesktopBeeAction(req, { approved: true });
  if (!resp.ok) return `Desktop Lane error: ${resp.error ?? "unknown"}`;
  const strat = resp.strategy ? ` [via ${resp.strategy}]` : "";
  const data = resp.data !== undefined ? `\n${JSON.stringify(resp.data).slice(0, 8_000)}` : "";
  const cap = resp.captureRef ? `\ncapture: ${resp.captureRef}` : "";
  return `Desktop Lane ${action} ok${strat}${data}${cap}`;
}
