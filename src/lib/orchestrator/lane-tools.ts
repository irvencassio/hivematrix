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
 * mail_send, …). Legacy bee-branded ids are still accepted on dispatch via
 * LANE_TOOL_ALIASES but never advertised; the removed browser ids
 * (webbee_search/browserbee_run) are rejected outright.
 */

import { getConnectivityPolicy, type CapabilityId } from "@/lib/connectivity/policy";
import type { ChatTool } from "./tool-bridge";
import { readToken } from "@/lib/auth/token";
import type { CooDispatchResult } from "@/lib/coo/dispatch";
import { PIM_TOOL_DEFINITIONS, executePimTool } from "./pim-tools";
import { getAutonomyLevel } from "@/lib/config/autonomy";
import { recordAudit } from "@/lib/audit/audit";

/** Tool name → the connectivity capability that gates it. */
const LANE_TOOL_CAPABILITY: Record<string, CapabilityId> = {
  coo_dispatch: "coo_router",
  workflow_inbox: "coo_router",
  hivematrix_browser: "browserbee",
  desktop_action: "desktopbee",
  mail_send: "mailbee",
  mail_draft: "mailbee",
  message_send: "messagebee",
  brain_search: "brain",
  brain_read: "brain",
  skill_used: "brain",
  skill_run: "brain",
  digest_url: "webbee",
  code_graph: "codegraph",
  // PIM tools are local osascript against this Mac's Contacts/Calendar/Reminders —
  // available in every connectivity mode (like brain), including fully offline.
  contacts_lookup: "brain",
  calendar_today: "brain",
  reminders_list: "brain",
  reminder_create: "brain",
  calendar_create: "brain",
  // Goals live in the local SQLite goals store (@/lib/goals/store) — no cloud
  // calls, so like brain/PIM they're always available, including offline.
  goals_list: "brain",
  goal_upsert: "brain",
  goal_checkin: "brain",
  daily_review: "brain",
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
      name: "workflow_inbox",
      description:
        "Workflow inbox / COO queue: read a concise, secret-free summary of pending workflow work — what needs review, what proposed actions are ready, what's blocked (and why), what failed, and what recently completed. READ-ONLY: this only reports counts and top items so you can tell the operator what to do next; it never approves, dispatches, or carries out any action itself.",
      parameters: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Optional: only show items for this workflow id" },
        },
        required: [],
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
      name: "brain_read",
      description:
        "Read the FULL text of a brain document by its path (as returned by brain_search). Use this after " +
        "brain_search to answer questions about the operator's goals, plans, or notes instead of relying on " +
        "snippets — a search hit only gives you a fragment; this gives you the whole document. The path must be " +
        "one returned by brain_search (or otherwise known to be under the brain root); an out-of-root path is refused. " +
        "Long documents come back in ~20k-char windows: if the result says it was truncated, call brain_read AGAIN with " +
        "the same path and the `offset` it tells you to continue reading — do NOT escalate a task just to finish reading.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The brain-root-relative doc path, e.g. as returned in a brain_search hit's `path` field" },
          offset: { type: "number", description: "Char offset to start reading from (default 0). Use the offset a truncated result reports to read the next window of a long doc." },
        },
        required: ["path"],
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
      name: "skill_run",
      description:
        "Skill library: RUN a skill from the library live, in this turn — not just record that you used one you already read (that's skill_used). An instruction skill returns its recipe (with any {{param}} placeholders filled in from `params`, and {{input}} filled from `input`) for you to follow right now. A script skill executes deterministically inside the sandbox (timeout, scratch cwd, secrets scrubbed) and returns its stdout — but ONLY if it is trusted or on probation and hasn't been blocked by the content scanner; an untrusted script is refused with the approval path named (trust it, or let it earn probation) rather than run. Every run is recorded automatically (no need to also call skill_used for it).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The skill name, as shown in the skill library index" },
          params: { type: "object", description: "Optional key/value substitutions for {{placeholders}} in the skill body" },
          input: { type: "string", description: "Optional free-text input for a skill's {{input}} slot" },
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
        "Digest a web link for later review: spawns a task that fetches the page, summarizes it, relates it to the operator's goals, and saves a brain doc. YouTube links get a rich, self-contained HTML doc (clickable link to the video, its thumbnail, a solid detailed summary from the transcript, and a 'how this applies to me' section tied to HiveMatrix/Solo Founder/other goals); other links get a markdown summary. Use for any link worth saving to the knowledge base (an article in an email, a video to study).",
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
  // PIM: Contacts / Calendar / Reminders — live local reads + the two low-risk
  // writes (reminder_create, calendar_create). Definitions live in pim-tools.ts.
  ...PIM_TOOL_DEFINITIONS,
  // Goals: the accountability/progress-tracking layer (@/lib/goals/store) —
  // structured, distinct from brain docs (prose) and directives/tasks
  // (one-shot/scheduled work). Local SQLite only, always available.
  {
    type: "function",
    function: {
      name: "goals_list",
      description:
        "Goals: list the operator's active goals — category, cadence (daily/weekly/milestone), status, target, last check-in (date + note), and whether each is due today. Use for \"what are my goals\", \"how am I doing on X\", or before deciding what to bring up in a check-in.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "paused", "done"], description: "Optional: filter to goals in this status (default active)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "goal_upsert",
      description:
        "Goals: create a new goal, or update an existing one (pass id to update). Use when the operator states a new goal (\"I want to hit $500K ARR\", \"I'm learning Italian\") or asks to change one (target, cadence, pause/resume/retire it). Categories are freeform (e.g. business, health, faith, language, personal).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Existing goal id to update (omit to create a new goal)" },
          title: { type: "string", description: "The goal's title (required)" },
          category: { type: "string", description: "Freeform category, e.g. business, health, faith, language, personal" },
          description: { type: "string", description: "Longer description/context for the goal" },
          cadence: { type: "string", enum: ["daily", "weekly", "milestone"], description: "How often it should be checked in on (default weekly)" },
          target: { type: "string", description: "The target/definition of done, e.g. \"$500K ARR\", \"run 5k\"" },
          metricUnit: { type: "string", description: "Unit for numeric check-in values, e.g. \"miles\", \"minutes\", \"USD\"" },
          nextAction: { type: "string", description: "The single concrete next step toward this goal, doable soon (e.g. \"sit a 30-min practice exam\", \"today's Italian lesson\"). Update it as progress is made." },
          status: { type: "string", enum: ["active", "paused", "done"], description: "Goal status (default active)" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "goal_checkin",
      description:
        "Goals: record progress against a goal — use whenever the operator reports doing something tied to a goal (\"I ran 3 miles\", \"did 20 minutes of Italian\", \"read a chapter of Proverbs\"). Resolves the goal by id or a fuzzy title match. If no goal matches, say so and suggest goals_list rather than guessing.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "The goal id, or its title/part of its title (e.g. \"Italian\", \"running\")" },
          note: { type: "string", description: "What was done, in a short note" },
          value: { type: "number", description: "Optional numeric progress value (e.g. 3 for '3 miles'), matching the goal's metricUnit" },
          date: { type: "string", description: "Optional date (YYYY-MM-DD) if not today" },
        },
        required: ["goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "daily_review",
      description:
        "Goals: the \"what should I do today / how am I doing\" view — active goals due today per their cadence (daily always unless already logged, weekly if not done this week, milestone if stale), each with its last check-in. Use for a morning/evening review or whenever the operator asks what they should focus on.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

export function isLaneTool(name: string): boolean {
  return resolveLaneToolName(name) in LANE_TOOL_CAPABILITY;
}

/** The connectivity capability that gates a lane tool, or undefined if unknown.
 *  Exposed read-only for callers (e.g. the /capabilities endpoint) that need
 *  to report a tool's gating capability without duplicating the map. */
export function laneToolCapabilityId(name: string): CapabilityId | undefined {
  return LANE_TOOL_CAPABILITY[resolveLaneToolName(name)];
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
  workflow_inbox: "See what workflow work is pending (needs review / ready / blocked / failed / recently completed) → **workflow_inbox** (read-only; never executes).",
  coo_dispatch: "Route a browser/site/workflow request through COO routing rules (Browser Lane is the canonical browser automation path) → **coo_dispatch**. Routing + prepare work in every mode; create=true makes the routed Browser Lane task when browser execution is available, otherwise it reports the work is waiting for connectivity (it never silently reroutes). When the request matches a registered workflow (e.g. the YouTube summary), the result names the workflow id + runbook.",
  mail_send: "Send an email → **mail_send** (sends to trusted recipients; drafts for approval otherwise). Save a draft only → **mail_draft**.",
  message_send: "Send an SMS / iMessage → **message_send** (allowlisted recipients only).",
  hivematrix_browser: "Read/search the live web or drive logged-in/multi-step browser workflows → **hivematrix_browser**.",
  desktop_action: "Control a native macOS app → **desktop_action**.",
  brain_search: "Recall a stored document / brain doc / past decision → **brain_search** (search durable memory before assuming it isn't written down), then **brain_read** on the matching path to get the FULL document instead of answering from the snippet alone.",
  code_graph: "Find where a symbol is defined + every place it's used → **code_graph** (exact, deterministic — use it to verify you found ALL usages of anything you changed, not just the obvious ones).",
  contacts_lookup: "A person's phone number or email → **contacts_lookup**. Today's schedule → **calendar_today**. Open to-dos → **reminders_list**. \"Remind me to X\" → **reminder_create** (sets a real Reminder NOW — don't spawn a task for it). \"Put X on my calendar\" / \"schedule X\" → **calendar_create** (creates a real Calendar event NOW; needs a start time, so ask if none was given — don't spawn a task for it).",
  goals_list: "\"What are my goals\" / \"how am I doing on X\" → **goals_list**. \"What should I focus on today\" / a daily review → **daily_review**. The operator reports doing something tied to a goal (\"I ran 3 miles\", \"did 20 min of Italian\") → **goal_checkin** (resolves the goal by id or fuzzy title). A new or changed goal (\"I want to hit $500K ARR\", pause/retire a goal) → **goal_upsert**. Goals are a structured store, separate from brain docs — don't answer these from brain_search/brain_read alone.",
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
    case "workflow_inbox":
      return executeWorkflowInbox(args);
    case "hivematrix_browser":
      return executeBrowserLane(args, ctx);
    case "desktop_action":
      return executeDesktopBeeAction(args);
    case "mail_send":
      return executeMailBeeSend(args);
    case "mail_draft":
      return executeMailBeeDraft(args);
    case "message_send":
      return executeMessageBeeSend(args);
    case "brain_search":
      return executeBrainSearch(args);
    case "brain_read":
      return executeBrainRead(args);
    case "skill_used":
      return executeSkillUsed(args);
    case "skill_run":
      return executeSkillRun(args);
    case "digest_url":
      return executeDigestUrl(args);
    case "code_graph":
      return executeCodeGraph(args, ctx);
    case "contacts_lookup":
    case "calendar_today":
    case "reminders_list":
    case "reminder_create":
    case "calendar_create":
      return executePimTool(name, args);
    case "goals_list":
      return executeGoalsList(args);
    case "goal_upsert":
      return executeGoalUpsert(args);
    case "goal_checkin":
      return executeGoalCheckin(args);
    case "daily_review":
      return executeDailyReview();
    default:
      return `Error: Unknown lane tool "${name}"`;
  }
}

// ── Goals lane (@/lib/goals/store) ─────────────────────────────────────────
//
// Local SQLite only — no cloud calls, so like brain/PIM these ride the
// "brain" capability and stay available offline. Every executor dynamic-
// imports the store, mirroring brain_read/brain_search above.

function formatGoalLine(g: { title: string; category: string | null; cadence: string; status: string; target: string | null; description?: string | null; nextAction?: string | null; streak?: number; lastCheckinDate: string | null; latestCheckin: { note: string | null } | null; dueToday: boolean }): string {
  const cat = g.category ? ` [${g.category}]` : "";
  const target = g.target ? ` — target: ${g.target}` : "";
  const due = g.dueToday ? " (due today)" : "";
  // Streak is a momentum signal — it lets a proactive nudge say "you're on a
  // 5-day run, keep it" vs "this one's gone cold" instead of a flat reminder.
  const streak = g.streak && g.streak > 1 ? ` — ${g.streak}-day streak` : "";
  const lastNote = g.latestCheckin?.note ? `: "${g.latestCheckin.note}"` : "";
  const last = g.lastCheckinDate ? `last check-in ${g.lastCheckinDate}${lastNote}` : "no check-ins yet";
  // The description carries what the goal actually is; the next action is THE
  // step to surface — call it out on its own line so a nudge has something
  // concrete to say rather than just naming the goal.
  const desc = g.description ? `\n    ↳ ${g.description}` : "";
  const next = g.nextAction ? `\n    → next: ${g.nextAction}` : "";
  return `- ${g.title}${cat} (${g.cadence}, ${g.status})${target}${due}${streak} — ${last}${desc}${next}`;
}

async function executeGoalsList(args: Record<string, unknown>): Promise<string> {
  const status = typeof args.status === "string" ? args.status.trim() : "";
  const { listGoals, goalsWithStatus } = await import("@/lib/goals/store");

  if (status && status !== "active") {
    const goals = listGoals({ status: status as "paused" | "done" });
    if (goals.length === 0) return `No goals with status "${status}".`;
    return goals.map((g) => `- ${g.title}${g.category ? ` [${g.category}]` : ""} (${g.cadence}, ${g.status})`).join("\n");
  }

  const goals = goalsWithStatus();
  if (goals.length === 0) return "No active goals yet. Use goal_upsert to add one, or ask to import goals from GOALS.md.";
  return goals.map(formatGoalLine).join("\n");
}

async function executeGoalUpsert(args: Record<string, unknown>): Promise<string> {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) return "Error: 'title' is required for goal_upsert.";
  const { upsertGoal } = await import("@/lib/goals/store");

  const cadence = typeof args.cadence === "string" && ["daily", "weekly", "milestone"].includes(args.cadence)
    ? (args.cadence as "daily" | "weekly" | "milestone")
    : undefined;
  const status = typeof args.status === "string" && ["active", "paused", "done"].includes(args.status)
    ? (args.status as "active" | "paused" | "done")
    : undefined;

  const goal = upsertGoal({
    id: typeof args.id === "string" && args.id.trim() ? args.id.trim() : undefined,
    title,
    category: typeof args.category === "string" ? args.category.trim() : undefined,
    description: typeof args.description === "string" ? args.description : undefined,
    cadence,
    target: typeof args.target === "string" ? args.target.trim() : undefined,
    metricUnit: typeof args.metricUnit === "string" ? args.metricUnit.trim() : undefined,
    nextAction: typeof args.nextAction === "string" ? args.nextAction.trim() : undefined,
    status,
  });
  const verb = args.id ? "Updated" : "Created";
  return `${verb} goal "${goal.title}" (${goal.cadence}${goal.category ? `, ${goal.category}` : ""}${goal.target ? `, target: ${goal.target}` : ""}). id: ${goal.id}`;
}

async function executeGoalCheckin(args: Record<string, unknown>): Promise<string> {
  const goalArg = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goalArg) return "Error: 'goal' (an id or title) is required for goal_checkin.";
  const { getGoal, findGoalByTitle, addCheckin } = await import("@/lib/goals/store");

  const resolved = getGoal(goalArg) ?? findGoalByTitle(goalArg);
  if (!resolved) {
    return `Error: no goal matching "${goalArg}" was found. Use goals_list to see what's tracked, or goal_upsert to create it.`;
  }

  const note = typeof args.note === "string" ? args.note.trim() : undefined;
  const value = typeof args.value === "number" ? args.value : undefined;
  const date = typeof args.date === "string" ? args.date.trim() : undefined;
  const checkin = addCheckin({ goalId: resolved.id, note, value, date });
  const valueStr = value !== undefined ? ` (${value}${resolved.metricUnit ? ` ${resolved.metricUnit}` : ""})` : "";
  return `Logged progress on "${resolved.title}" for ${checkin.date}${valueStr}${note ? `: ${note}` : ""}.`;
}

async function executeDailyReview(): Promise<string> {
  const { goalsDueToday } = await import("@/lib/goals/store");
  const due = goalsDueToday();
  if (due.length === 0) return "Nothing due today — every active goal is caught up.";
  const lines = due.map(formatGoalLine);
  return `Due today (${due.length}):\n${lines.join("\n")}`;
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

async function executeWorkflowInbox(args: Record<string, unknown>): Promise<string> {
  // READ-ONLY: build the inbox and report a concise operational summary. Never executes.
  const { getWorkflowInbox, formatWorkflowInboxSummary } = await import("@/lib/workflows/inbox");
  const inbox = getWorkflowInbox({ workflowId: typeof args.workflowId === "string" ? args.workflowId : undefined });
  const lines = [formatWorkflowInboxSummary(inbox)];
  const top = (group: string, label: string) => {
    for (const item of inbox.groups[group as keyof typeof inbox.groups].slice(0, 3)) {
      lines.push(`- [${label}] ${item.title} — ${item.nextAction}`);
    }
  };
  top("needs_review", "review");
  top("proposed_actions_ready", "ready");
  top("proposed_actions_blocked", "blocked");
  return lines.join("\n");
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

async function executeBrainRead(args: Record<string, unknown>): Promise<string> {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return "Error: 'path' is required for brain_read.";
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0;
  const { readBrainDoc, formatBrainReadResult } = await import("@/lib/brain/read");
  return formatBrainReadResult(await readBrainDoc(path, { offset }));
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

/** Coerce a tool-arg `params` object into a plain string map (non-objects/arrays ignored). */
function readSkillParamsArg(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

/**
 * skill_run: run a skill live, in this turn. Instruction skills carry no
 * execution risk — the body is just handed back for the model to follow, so
 * only the library-membership check applies. Script skills are the risky
 * path: they execute inside runSkillSandboxed (P1.1) ONLY IF trusted or on
 * probation and not scanner-blocked; every other script is refused with the
 * approval path named, never silently run. Both paths record the outcome via
 * recordSkillOutcome (P1.2) so useCount/failures — and promotion/demotion —
 * stay accurate without a separate skill_used call.
 */
async function executeSkillRun(args: Record<string, unknown>): Promise<string> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return "Error: 'name' (the skill name) is required for skill_run.";
  const params = readSkillParamsArg(args.params);
  const input = typeof args.input === "string" ? args.input : undefined;

  const { readSkill, recordSkillOutcome } = await import("@/lib/skills/store");
  const skill = await readSkill(name);
  if (!skill) return `Error: no skill named "${name}" in the library.`;

  if (skill.kind === "instruction") {
    const { applySkillParams, applySkillInput } = await import("@/lib/skills/contracts");
    let body = applySkillParams(skill.body, params);
    if (input) body = applySkillInput(body, input);
    await recordSkillOutcome(name, true);
    return `Skill "${name}" (follow these steps now):\n\n${body}`;
  }

  // kind === "script": the risky path. Refuse upstream of the sandbox — never
  // run a blocked or untrusted/non-probationary script.
  if (skill.scanVerdict === "block") {
    return `Error: skill "${name}" is blocked by the content scanner and cannot run.`;
  }
  if (!(skill.trusted || skill.probation)) {
    return `Error: skill "${name}" is an untrusted script and won't run. Approve it (Trust it in the Skills view, or let it earn probation) before it can execute.`;
  }

  const { runSkillSandboxed } = await import("@/lib/skills/sandbox");
  const r = await runSkillSandboxed(skill, { params, input });
  await recordSkillOutcome(name, r.ok);

  // Probationary scripts are still being trusted with real trust — announce
  // every run so the operator sees when a recently-learned script is in play.
  const prefix = skill.probation ? "(using a skill I learned recently) " : "";
  if (r.ok) {
    const out = r.stdout.trim();
    return `${prefix}Skill "${name}" ran successfully.${out ? ` Output:\n${out}` : " It produced no output."}`;
  }
  const why = r.timedOut
    ? `timed out after ${Math.round(r.durationMs / 1000)}s`
    : `exited with code ${r.exitCode ?? "unknown"}`;
  const stderrTail = r.stderr.trim().slice(-500);
  return `${prefix}Skill "${name}" failed (${why})${stderrTail ? ` — stderr: ${stderrTail}` : ""}.`;
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
  isChannelEnabled?(): boolean;
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
    isChannelEnabled: store.isChannelEnabled,
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

  if (deps.isChannelEnabled && !deps.isChannelEnabled()) {
    return "Error: Mail Lane is disabled. Enable Mail Lane before sending or drafting email.";
  }

  if (!deps.isTrustedRecipient(to)) {
    const drafted = await deps.draftMail(to, subject, body, attachments);
    // Untrusted recipient is a hard safety floor — it holds regardless of the
    // autonomy dial. Under "autonomous" the operator has otherwise opted out of
    // routine approvals, so name the actual blocker (the allowlist, not the
    // dial) so they know exactly how to unblock future sends to this address.
    const floorNote = getAutonomyLevel() === "autonomous"
      ? " Autonomy is set to autonomous, but the Mail Lane allowlist is a hard safety floor that the autonomy dial does not bypass."
      : "";
    return drafted
      ? `Recipient ${to} is not on the Mail Lane trusted allowlist, so the email was NOT sent — it was saved to Mail Drafts${att} for your approval.${floorNote} Approve/edit it in Mail.app, or add ${to} (or its domain) to the Mail Lane allowlist to enable autonomous send.`
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

  if (deps.isChannelEnabled && !deps.isChannelEnabled()) {
    return "Error: Mail Lane is disabled. Enable Mail Lane before sending or drafting email.";
  }

  const drafted = await deps.draftMail(to, subject, body, attachments);
  return drafted
    ? `Draft saved to Mail Drafts for ${to}${att} — review and send it from Mail.app when ready.`
    : `Error: saving the draft to Mail failed. Is Mail.app running with Automation permission granted?`;
}

export interface MessageBeeSendIO {
  isChannelEnabled?(): boolean;
  isSelf?(handle: string): boolean;
  isAllowed(handle: string): boolean;
  /** The agent's own handles; the first pins the sending account (see SEND_SCRIPT). */
  getSelfHandles?(): string[];
  sendIMessage(handle: string, text: string, attachments?: string[], sendAs?: string): Promise<boolean>;
  recordOutbound(): void;
}

async function defaultMessageBeeIO(): Promise<MessageBeeSendIO> {
  const store = await import("@/lib/messagebee/store");
  const im = await import("@/lib/messagebee/imessage");
  return {
    isChannelEnabled: store.isChannelEnabled,
    isSelf: store.isSelf,
    isAllowed: store.isAllowed,
    getSelfHandles: store.getSelfHandles,
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

  if (deps.isChannelEnabled && !deps.isChannelEnabled()) {
    return "Error: Message Lane is disabled. Enable Message Lane before sending SMS/iMessage.";
  }

  if (deps.isSelf?.(to)) {
    return `Error: refusing to send SMS/iMessage to ${to} because it is configured as a Message Lane self handle. This would echo back as inbound and loop.`;
  }

  if (!deps.isAllowed(to)) {
    // Non-allowlisted recipient is a hard safety floor — it holds regardless of
    // the autonomy dial. Under "autonomous" the operator has otherwise opted
    // out of routine approvals, so name the actual blocker (the allowlist, not
    // the dial) so they know exactly how to unblock future sends to this handle.
    const floorNote = getAutonomyLevel() === "autonomous"
      ? " Autonomy is set to autonomous, but the Message Lane allowlist is a hard safety floor that the autonomy dial does not bypass."
      : "";
    return `Error: ${to} is not on the Message Lane allowlist. SMS/iMessage can only be sent to allowlisted handles — add ${to} in Message Lane settings first, then retry.${floorNote}`;
  }

  const sendAs = deps.getSelfHandles?.()[0] ?? "";
  const sent = await deps.sendIMessage(to, text, attachments, sendAs);
  if (sent) deps.recordOutbound();
  const what = attachments.length ? `Message (with ${attachments.length} attachment(s))` : "Message";
  return sent
    ? `${what} sent to ${to} via Messages.`
    : `Error: sending the message to ${to} failed. Is Messages signed in and the handle reachable via iMessage?`;
}

async function executeBrowserLaneRead(args: Record<string, unknown>, ctx: LaneToolContext): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return "Error: query is required";
  const freshness = (["low", "medium", "high"].includes(args.freshness as string)
    ? args.freshness
    : "high") as "low" | "medium" | "high";

  // Compliance/identity audit — Canopy parity: every Browser Lane read is on the
  // trail with the requesting identity, never the answer text (only the query).
  const audit = (status: string, target?: string): void =>
    recordAudit({ ts: "", event: "browser:read", actor: ctx.requestedBy, project: ctx.project, prompt: query, target, status });

  const { requestBrowserLaneRead } = await import("@/lib/browser-lane/read-client");
  try {
    const res = await requestBrowserLaneRead({ query, requestedBy: ctx.requestedBy, project: ctx.project, freshness });
    if (!res.ok) { audit(`http_${res.status}`); return `Error: Browser Lane returned HTTP ${res.status}`; }
    const data = await res.json() as import("@/lib/browser-lane/read-client").BrowserLaneReadResult;
    if (data.status === "failed") { audit("failed"); return `Browser Lane failed: ${data.errorCode ?? "unknown error"}`; }
    const cites = data.citations?.length
      ? "\n\nSources:\n" + data.citations.map((c, i) => `[${i + 1}] ${c.title} — ${c.url}`).join("\n")
      : "";
    const esc = data.escalation?.needed ? `\n\n(Browser Lane suggests a rendered/authenticated workflow: ${data.escalation.reason ?? ""})` : "";
    audit("ok", data.citations?.[0]?.url);
    return `${data.answer ?? "(no answer)"}${cites}${esc}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    audit("unreachable");
    return `Error: Browser Lane read service unreachable — ${msg}. Open the Browser Lane app (it serves reads on http://127.0.0.1:4011/answer) and retry.`;
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
    // Audit the dispatch itself (start URL, login requirement, backing engine,
    // requesting identity) — not just the eventual task_completed record.
    recordAudit({
      ts: "", event: "browser:job_created", actor: ctx.requestedBy, project: payload.project,
      taskId: task._id, target: payload.startUrl,
      summary: `${payload.title} — ${laneLabel}${payload.requiresLogin ? " (login required)" : ""}`,
      status: "created",
    });
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
