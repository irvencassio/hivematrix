/**
 * Flash MCP server — exposes the Flash lane tools (brain_search, mail_send,
 * hivematrix_browser, PIM, …) plus the four Flash-only tools (persona_update,
 * generate_avatar, deep_think, escalate_to_task) to the `claude` CLI as a
 * stdio MCP server, modeled on `src/lib/orchestrator/outbound-mcp.ts`.
 *
 * Two different tool shapes get bridged here:
 *   - Lane tools already have a generic HTTP dispatch point
 *     (`POST /bee/:tool` → executeLaneTool, server.ts). The embedded server
 *     just proxies to it.
 *   - The four Flash-only tools have real business logic (file writes to the
 *     persona dir, Task creation, deep-think) that must run in the DAEMON
 *     process, not the child MCP stdio process — so this file also owns
 *     their implementations, dispatched by a small auth-gated daemon route
 *     (`POST /flash/tool/:name`, wired in server.ts) that the embedded
 *     server proxies to, same shape as the /bee/:tool proxy.
 *
 * Gating (critical, per the cutover plan): prompt-level tool guidance is not
 * a guarantee. The embedded server enforces an allow-list at CALL time
 * (env HIVE_FLASH_ALLOWED), independent of what `--allowedTools` told the CLI
 * to offer — a model that emits a call for a tool it was never offered still
 * gets refused here, mirroring the old in-process gate at loop.ts's dispatch
 * site (READ_ONLY_FLASH_TOOLS et al.).
 *
 * `tools/list` always returns the FULL reachable catalog (capability-gated by
 * ConnectivityPolicy, not by the allow-list) — that way a read-only pass can
 * still be tested end to end: list shows the write tool exists, and a
 * `tools/call` for it is refused. The allow-list is a separate, narrower gate
 * layered on top.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { loadHiveConfig } from "@/lib/central/config";
import { resolveProjectByName } from "@/lib/routing/aliases";
import { availableLaneTools, LANE_TOOL_DEFINITIONS, type LaneToolContext } from "@/lib/orchestrator/lane-tools";
import type { ChatTool } from "@/lib/orchestrator/tool-bridge";
import { broadcastEvent } from "@/lib/ws/broadcaster";
import type { AcquireResult } from "@/lib/skills/acquire";
import type { SkillIndexEntry } from "@/lib/skills/contracts";

// Re-exported so existing importers keep working; the definition (and the
// namespacing helpers that must agree with it) now live in tool-names.ts.
import { FLASH_MCP_SERVER_NAME, flashToolName } from "./tool-names";
export { FLASH_MCP_SERVER_NAME };

// ------------------------------------------------------------------
// Flash-only tool definitions + handlers (moved from loop.ts — these need
// real imports/logic, unlike the lane tools which just proxy to /bee/:tool).
// ------------------------------------------------------------------

export const FLASH_ONLY_TOOL_NAMES = ["persona_update", "generate_avatar", "deep_think", "escalate_to_task", "learn_skill", "list_tasks", "get_task"] as const;
export type FlashOnlyToolName = (typeof FLASH_ONLY_TOOL_NAMES)[number];

export function isFlashOnlyTool(name: string): name is FlashOnlyToolName {
  return (FLASH_ONLY_TOOL_NAMES as readonly string[]).includes(name);
}

export const FLASH_ONLY_TOOL_DEFS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "persona_update",
      description:
        "Write a persona file (SOUL.md, IDENTITY.md, USER.md, or GOALS.md) in the brain persona directory. " +
        "Use when the operator asks to update identity/persona, or to record a goal they state in GOALS.md. " +
        "Every call emits a visible notice and an audit event.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"] },
          content: { type: "string", description: "Full new content for the file" },
          reason: { type: "string", description: "Brief reason shown to the operator" },
        },
        required: ["file", "content", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_avatar",
      description:
        "Generate an avatar image and save it as the persona avatar (persona/avatar.png). " +
        "Use during the birth ritual when the agent is choosing its visual identity. " +
        "Accepts an image generation prompt describing the desired image.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Concrete visual description for the image generator (shape, colors, style)" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deep_think",
      description:
        "Deep reasoning for HARD questions: runs several independent Opus attempts, cross-checks them for " +
        "agreement, and reconciles disagreements with a skeptical revision pass. Slow (up to a few minutes) but " +
        "far more reliable than a single answer. Use for strategy decisions, tricky analysis, math/logic, or " +
        "anything where a wrong answer is costly. NOT for simple lookups, casual chat, or things a tool can " +
        "answer directly.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, fully self-contained — include all context needed to answer it, since this runs fresh without the conversation history.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_task",
      description:
        "Escalate a complex multi-step request to a background task (the coding harness plans and executes it). " +
        "Use when the task cannot be completed in a single conversation turn.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the task" },
          description: {
            type: "string",
            description:
              "What needs to be done, in the OPERATOR'S OWN TERMS. Include what they actually asked for plus " +
              "context you directly observed — nothing else. Do NOT invent scope: no made-up test targets, " +
              "example sites, acceptance criteria, deployment steps, or multi-part solution designs the operator " +
              "never mentioned. A fabricated detail becomes real work and real risk downstream (a spec that " +
              "listed a 'banking portal' to test credential auto-fill against sent a worker asking about a bank " +
              "integration that does not exist). If you are proposing an approach rather than relaying a request, " +
              "say so explicitly and keep it to a sentence or two — the coding harness plans the solution, not you. " +
              "Do not re-propose capabilities that already ship today, and never propose something that " +
              "contradicts a standing operator rule (e.g. credential use always requires an explicit human click).",
          },
          project: {
            type: "string",
            description:
              "Name of the target project/repo, e.g. \"hivematrix-ios\" or \"ohio-life-ace\" — resolved " +
              "automatically against known projects. Prefer this over projectPath when you know the project " +
              "by name but not its exact path. " +
              "If the operator NAMES a repo in their request (\"in hivematrix-ios, ...\"), pass exactly that " +
              "name — never substitute a similarly-named one. Picking the wrong repo is silently expensive: " +
              "the coding agent opens that checkout, cannot find the files it was asked to change, and may " +
              "edit the wrong project (a request to restructure hivematrix-ios navigation was filed against " +
              "hivematrix and would have run in the daemon repo). The iOS app and its embedded WATCH app both " +
              "live in \"hivematrix-ios\" — there is no separate shippable watch repo. " +
              "Omit only for tasks with no specific project (e.g. \"book a flight\").",
          },
          projectPath: {
            type: "string",
            description: "Absolute path to the project (optional) — only use this if you already know the exact path; prefer `project` otherwise.",
          },
          kind: {
            type: "string",
            enum: ["self-improvement"],
            description:
              "Set to 'self-improvement' when the task is about improving HiveMatrix's own code/features — " +
              "it will be routed to the HiveMatrix repo with the Superpowers workflow.",
          },
        },
        required: ["title", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "learn_skill",
      description:
        "Use when the operator asks for a capability you don't have and no existing tool/skill covers it — " +
        "you'll learn it as a new skill. Acquisition takes a few minutes: you'll ack now and speak the result " +
        "when it's ready. Do NOT use for things a tool/skill already does.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "What capability to acquire, fully self-contained (this runs without the conversation history)." },
          why_needed: { type: "string", description: "Why this is needed / the operator's ask." },
          suggested_kind: { type: "string", enum: ["instruction", "script"], description: "Optional hint at the skill shape." },
        },
        required: ["goal", "why_needed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List HiveMatrix's own tasks (the task board). Use to answer \"what's running / failed / in review?\" or to " +
        "find a task before looking it up with get_task. Read-only.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional filter: failed, review, in_progress, done, backlog, cancelled, archived." },
          limit: { type: "number", description: "Max tasks to return (default 15, max 50)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_task",
      description:
        "Look up ONE HiveMatrix task by id (full or short) or a title fragment, and return its status, error, " +
        "result, and recent activity log. Use this to DIAGNOSE a task yourself — e.g. when the operator asks \"why " +
        "did this task fail?\" read the task's error and log tail instead of asking them to screenshot it. Read-only.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task id (full or first several chars) or a distinctive part of its title." },
        },
        required: ["task"],
      },
    },
  },
];

async function handlePersonaUpdate(args: Record<string, unknown>, brainRoot: string | null): Promise<string> {
  const file = String(args.file ?? "");
  const content = String(args.content ?? "");
  const reason = String(args.reason ?? "");

  if (!["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"].includes(file)) {
    return `Error: invalid persona file "${file}" — must be SOUL.md, IDENTITY.md, USER.md, or GOALS.md`;
  }
  if (!brainRoot) return "Error: brain root not configured";

  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);

  if (existsSync(path)) {
    // Keep a timestamped backup in the same directory
    const backup = join(dir, `${file}.${Date.now()}.bak`);
    writeFileSync(backup, readFileSync(path));
  }

  writeFileSync(path, content, "utf-8");
  broadcastEvent("flash:persona_updated", { file, reason, ts: new Date().toISOString() });

  return `persona_update: ${file} written (${content.length} chars). Reason: ${reason}`;
}

async function handleGenerateAvatar(args: Record<string, unknown>, brainRoot: string | null): Promise<string> {
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) return "Error: prompt is required";
  if (!brainRoot) return "Error: brain root not configured";

  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "avatar.png");

  const mode = getConnectivityPolicy().mode;
  const { generateViaNanai, generateViaMflux } = await import("@/lib/orchestrator/image-gen");

  let result: { ok: boolean; detail: string };
  if (mode === "cloud-ok") {
    result = await generateViaNanai(prompt, outPath);
    if (!result.ok) result = await generateViaMflux(prompt, outPath);
  } else {
    result = await generateViaMflux(prompt, outPath);
  }

  if (result.ok) {
    broadcastEvent("flash:persona_updated", { file: "avatar.png", reason: "avatar generated", ts: new Date().toISOString() });
    return `Avatar generated at ${outPath}`;
  }
  return `Avatar generation attempted but failed: ${result.detail}. You can describe yourself in text instead — the operator can add an image manually later.`;
}

async function handleDeepThink(args: Record<string, unknown>): Promise<string> {
  const question = String(args.question ?? "").trim();
  if (!question) return "Error: question is required";
  const { deepThink } = await import("@/lib/models/deep-think");
  // deepThink defaults its `complete` backend to opusChatComplete (Phase 2) —
  // deep_think is genuinely a thinking-role call, routed to Opus.
  const r = await deepThink(question, { samples: 3, callTimeoutMs: 60_000, maxWallMs: 150_000 });
  return (
    `${r.answer}\n\n` +
    `[deep-think: ${r.candidates} attempts, ${Math.round(r.agreement * 100)}% agreement, ` +
    `confidence ${r.confidence}${r.reflected ? ", revised after disagreement" : ""}, ${Math.round(r.elapsedMs / 1000)}s]`
  );
}

/** Prefix stamped on a self-improvement task's description — AGENTS.md already
 *  enforces the Superpowers pipeline in-repo; this just makes sure the task
 *  says so up front, since the escalating model doesn't necessarily know. */
const SELF_IMPROVEMENT_PREFIX =
  "[Self-improvement task — follow the Superpowers pipeline in AGENTS.md: brainstorm → plan → " +
  "subagent-driven TDD → finish. Do NOT release; the operator releases. " +
  "Git hygiene (AGENTS.md): the working tree is SHARED — stage the files you actually touched by " +
  "name, never `git add -A`, and COMMIT your work before finishing so it can't be swept into " +
  "someone else's commit. Never merge to main and never resolve a conflict; that is the " +
  "operator's call.]\n\n";

export interface ResolveEscalationTargetOpts {
  title: string;
  description: string;
  /** Raw `kind` arg off the tool call, if any (e.g. "self-improvement"). */
  kind?: string;
  /** `project` name arg off the tool call, if any (e.g. "hivematrix-watch") —
   *  resolved via resolveProjectByName. Takes priority over argProjectPath
   *  when both are given: a name is more robust than a guessed path. */
  argProject?: string;
  /** `projectPath` arg off the tool call, if any — used when NOT
   *  self-improvement and no (resolvable) argProject was given. */
  argProjectPath?: string;
  /** The resolved HiveMatrix repo path — injected so this helper stays pure/testable
   *  (see `selfImproveRepoPath()` for how the real dispatch site resolves it). */
  repoPath: string;
}

export interface EscalationTarget {
  project: string;
  projectPath: string;
  description: string;
  isSelfImprove: boolean;
  /** Set only when an explicit `project` name was given but couldn't be
   *  resolved — callers must surface this instead of creating a task (never
   *  silently fall back to homedir() for a name that was given but wrong).
   *  project/projectPath are "" in this case. */
  error?: string;
}

/**
 * Pure decision helper for `handleEscalateToTask`: does this escalation target
 * HiveMatrix's own repo, and if so, route it there with the Superpowers
 * pipeline requirement prefixed onto the description. Self-improvement is
 * detected either explicitly (`kind: "self-improvement"`) or implicitly (the
 * title/description names HiveMatrix) — per the design doc, escalating models
 * won't always remember to set `kind`.
 */
export function resolveEscalationTarget(opts: ResolveEscalationTargetOpts): EscalationTarget {
  const { title, description, kind, argProject, argProjectPath, repoPath } = opts;
  const isSelfImprove = kind === "self-improvement" || /\bhive\s?matrix\b(?!-)/i.test(`${title} ${description}`);

  if (isSelfImprove) {
    return {
      project: "hivematrix",
      projectPath: repoPath,
      description: SELF_IMPROVEMENT_PREFIX + description,
      isSelfImprove: true,
    };
  }

  const projectName = argProject?.trim();
  if (projectName) {
    const resolved = resolveProjectByName(projectName);
    if (!resolved) {
      return {
        project: "",
        projectPath: "",
        description,
        isSelfImprove: false,
        error: `Cannot find project "${projectName}" — it isn't a known alias or a discovered git repo. Check ~/.hivematrix/discovered-projects.json, or pass an explicit projectPath instead.`,
      };
    }
    return { project: resolved.name, projectPath: resolved.path, description, isSelfImprove: false };
  }

  if (argProjectPath) {
    return { project: basename(argProjectPath), projectPath: argProjectPath, description, isSelfImprove: false };
  }

  return { project: "hivematrix", projectPath: homedir(), description, isSelfImprove: false };
}

/**
 * Resolves the HiveMatrix repo path for self-improvement escalations — reads
 * the operator-configurable `selfImprove.repoPath` config key (this task's
 * "settings surface": config.ts itself stays a pure untyped load/save blob,
 * per its existing style — see `learningLoop`/`memory.brainRootDir` for the
 * same ad-hoc-nested-read convention elsewhere in this codebase — so this
 * reader lives here rather than in config.ts).
 *
 * Falls back to `process.cwd()` when unset. In DEV that IS this repo
 * checkout, so it works with zero configuration. In the PACKAGED app, cwd is
 * the bundle root, not a git checkout of hivematrix — the operator MUST set
 * `selfImprove.repoPath` in ~/.hivematrix/config.json for self-improvement
 * escalations to land in the right place there.
 *
 * Falls back further to an auto-discovered "hivematrix" repo (via
 * resolveProjectByName) before finally giving up and using cwd — this
 * makes the unconfigured packaged-app case land in the real checkout
 * instead of the LaunchAgent's homedir() working directory, without
 * removing the "operator should configure this" contract above.
 */
export function selfImproveRepoPath(): string {
  const cfg = loadHiveConfig().selfImprove as { repoPath?: unknown } | undefined;
  const configured = typeof cfg?.repoPath === "string" ? cfg.repoPath.trim() : "";
  if (configured) return configured;
  // In the packaged app, process.cwd() is the LaunchAgent's WorkingDirectory
  // (homedir() — see onboarding/actions.ts's plist), never a git checkout,
  // so try the auto-discovered "hivematrix" repo before falling back to cwd.
  const discovered = resolveProjectByName("hivematrix");
  return discovered?.path || process.cwd();
}

/** Pure: whether an escalation made on this per-request channel should be
 * marked voice-origin for the loop-closer's OS-notification gate. Reads the
 * REQUEST's channel (threaded through from loop.ts -> prepareFlashMcp ->
 * the MCP env -> this dispatch call), NOT the session row's `channel` column
 * — that column may now be collapsed to a shared "operator" value across
 * console+voice sessions (see store.ts's storageChannel), so it can no
 * longer answer "was THIS turn voice?". */
export function escalationIsVoice(channel?: string): boolean {
  return channel === "voice";
}

async function handleEscalateToTask(args: Record<string, unknown>, sessionId: string, channel?: string): Promise<string> {
  const { Task, generateId } = await import("@/lib/db");
  const { markVoiceOrigin } = await import("@/lib/voice/loop-closer");

  const title = String(args.title ?? "Task");
  const kind = String(args.kind ?? "");
  const argProject = typeof args.project === "string" ? args.project : undefined;
  const argProjectPath = typeof args.projectPath === "string" ? args.projectPath : undefined;

  const target = resolveEscalationTarget({
    title,
    description: String(args.description ?? ""),
    kind,
    argProject,
    argProjectPath,
    repoPath: selfImproveRepoPath(),
  });

  if (target.error) return `Error: ${target.error}`;

  const { project, projectPath, description } = target;

  // A task escalated from a voice-channel flash turn gets the same
  // voice-origin marker the /voice/session route uses, so the loop-closer
  // (src/lib/voice/loop-closer.ts) texts the outcome back once this task
  // reaches a terminal state.
  const isVoice = escalationIsVoice(channel);

  // Broad multi-step work dispatches as a SINGLE task that self-plans via
  // Superpowers: workflow:"work" triggers the "/workflows:work" skill prefix so
  // the frontier coding harness plans and executes its own subtasks. Self-improvement
  // tasks are normal tasks in every other respect — they flow through the same
  // approval queue and directive machinery.
  const task = await Task.create({
    _id: generateId(),
    title,
    description,
    project,
    projectPath,
    executor: "agent",
    model: "mixed",
    workflow: "work",
    source: `flash:${sessionId}`,
    ...(isVoice ? { output: markVoiceOrigin() } : {}),
  });

  // Deliberately NOT calling an emitter here — this handler runs in a bridged
  // daemon HTTP request, not the Flash turn's own request scope. The loop
  // (loop.ts's consumeFlashStreamLine) parses this exact "Escalated to task
  // <id>:" string out of the tool_result event and calls emit.escalated(id),
  // preserving the client-facing escalation signal across the MCP boundary.
  return `Escalated to task ${task._id}: "${title}"`;
}

const LEARN_SKILL_ACK =
  "I don't know how to do that yet. Give me a few minutes to learn it — I'll speak up when I've got it.";

/** Test seam type for `deliverLearnSkillReply`'s injectable `acquire` — narrower than the
 *  full `AcquireOptions` since only these three fields are ever passed from the tool call. */
type LearnSkillAcquireFn = (opts: {
  goal: string;
  whyNeeded: string;
  suggestedKind?: "instruction" | "script";
}) => Promise<AcquireResult>;

async function handleLearnSkill(
  args: Record<string, unknown>,
  opts: { brainRoot: string | null; sessionId: string; channel?: string },
): Promise<string> {
  const goal = String(args.goal ?? "").trim();
  if (!goal) return "Error: goal is required";
  const whyNeeded = String(args.why_needed ?? "").trim();
  const suggestedKindRaw = args.suggested_kind;
  const suggestedKind: "instruction" | "script" | undefined =
    suggestedKindRaw === "instruction" || suggestedKindRaw === "script" ? suggestedKindRaw : undefined;

  // The REQUEST's channel (threaded through from loop.ts, same as
  // escalate_to_task above) — not the session row's, which may now be
  // collapsed to a shared "operator" value across console+voice sessions.
  const channel = opts.channel || "chat";

  // Acquisition takes minutes — kick it off DETACHED (never awaited here) and
  // return the ack immediately, mirroring deep_think/heartbeat's async
  // speak-back pattern (voice/command-turn.ts's deliverDeepThinkReply /
  // deliverHeartbeatReply). The outcome is broadcast once it lands.
  void deliverLearnSkillReply({ sessionId: opts.sessionId, channel, goal, whyNeeded, suggestedKind }).catch((err) => {
    console.error(`[flash] learn_skill delivery failed: ${err instanceof Error ? err.message : err}`);
  });

  return LEARN_SKILL_ACK;
}

/**
 * Run skill acquisition in the background, then speak/notice the outcome —
 * mirrors `deliverDeepThinkReply` in voice/command-turn.ts (voice/ must not
 * import flash/, but flash/ may import voice/, so this delivery helper lives
 * here and calls into voice utilities for synthesis).
 *
 * Budget rail: a HARD wall-clock cap (default 10 min) races the acquisition —
 * on expiry we speak an honest "still working" style failure rather than
 * hanging the speak-back forever. On success/failure, `result.reason` is
 * ALWAYS the spoken outcome (acquireSkill's contract: honest even on
 * failure), only `ok` distinguishes a genuine capability gain from a miss.
 */
export async function deliverLearnSkillReply(opts: {
  sessionId: string;
  channel: string;
  goal: string;
  whyNeeded: string;
  suggestedKind?: "instruction" | "script";
  acquire?: LearnSkillAcquireFn;
  synthesize?: (text: string) => Promise<string>;
  broadcast?: (event: string, data: unknown) => void;
  wallClockMs?: number;
}): Promise<void> {
  const { sessionId, channel, goal, whyNeeded, suggestedKind } = opts;
  const wallClockMs = opts.wallClockMs ?? 10 * 60 * 1000;

  let text: string;
  let ok: boolean;
  try {
    const acquire: LearnSkillAcquireFn =
      opts.acquire ?? (await import("@/lib/skills/acquire")).acquireSkill;

    const TIMED_OUT = Symbol("learn-skill-timeout");
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), wallClockMs);
    });

    // `finally` (not a bare statement after the await) so the timer is
    // cleared on EITHER outcome of the race, including when `acquire`
    // rejects — a rejection makes Promise.race itself reject, which would
    // otherwise skip straight past a clearTimeout placed after the await and
    // leave a 10-minute timer alive, blocking process exit.
    let result: AcquireResult | typeof TIMED_OUT;
    try {
      result = await Promise.race([acquire({ goal, whyNeeded, suggestedKind }), timeout]);
    } finally {
      clearTimeout(timer!);
    }
    if (result === TIMED_OUT) {
      ok = false;
      text = "I couldn't finish learning that in time — I've saved my progress and will try again later.";
    } else {
      // Non-failure outcomes: a skill was actually gained (or already existed).
      ok = result.outcome === "registered" || result.outcome === "probation" || result.outcome === "already-have";
      text = result.reason;
    }
  } catch (e) {
    ok = false;
    text = `I couldn't learn that: ${e instanceof Error ? e.message : "unknown error"}.`;
  }

  let audioBase64 = "";
  if (channel === "voice") {
    try {
      const synth = opts.synthesize ?? (await import("@/lib/voice/turn-server")).synthesizeReplyVoice;
      const path = await synth(text);
      audioBase64 = path ? readFileSync(path).toString("base64") : "";
    } catch { /* speak-less fallback */ }
  }

  const broadcastFn = opts.broadcast ?? broadcastEvent;
  try {
    if (channel === "voice") {
      broadcastFn("voice:result", { sessionId, text, audioBase64, ok });
    } else {
      broadcastFn("flash:notice", { sessionId, text, ok });
    }
  } catch (e) {
    console.error(`[flash] learn_skill broadcast failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Dispatch a Flash-only tool call — called by the `/flash/tool/:name` daemon route. */
export async function dispatchFlashOnlyTool(
  name: string,
  args: Record<string, unknown>,
  opts: { brainRoot: string | null; sessionId: string; channel?: string },
): Promise<string> {
  switch (name) {
    case "persona_update":
      return handlePersonaUpdate(args, opts.brainRoot);
    case "generate_avatar":
      return handleGenerateAvatar(args, opts.brainRoot);
    case "deep_think":
      return handleDeepThink(args);
    case "escalate_to_task":
      return handleEscalateToTask(args, opts.sessionId, opts.channel);
    case "learn_skill":
      return handleLearnSkill(args, opts);
    case "list_tasks": {
      const { listTasksText } = await import("./task-lookup");
      return listTasksText({
        status: typeof args.status === "string" ? args.status : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    }
    case "get_task": {
      const { getTaskDetailText } = await import("./task-lookup");
      return getTaskDetailText(String(args.task ?? ""));
    }
    default:
      return `Error: Unknown flash-only tool "${name}"`;
  }
}

// ------------------------------------------------------------------
// Curated skills-as-tools (Feature: evolve skills into first-class MCP
// tools). Today the model only sees skills via the text index
// (flash/context.ts's formatSkillIndex) + the one generic `skill_run` tool.
// A CURATED subset — skills that opt in via frontmatter `tool: true`, plus
// the top-N most-used skills — gets synthesized into its own named MCP tool
// (`skill_<name>`) so the model can select it directly like any native tool,
// instead of having to first read the text index and then call skill_run
// with the right `name` string. Every other skill (the long tail) stays
// reachable only through skill_run — this is deliberately NOT a replacement
// for skill_run, just a better front door for the skills worth promoting.
// ------------------------------------------------------------------

/** Default number of NON-tagged skills promoted by usage (most-used first). */
export const DEFAULT_CURATED_TOP_N = 8;
/** Hard cap on the total number of curated skill tools offered — keeps the
 *  model's tool list from bloating no matter how many skills opt in. */
export const DEFAULT_CURATED_CAP = 12;

export interface CuratedSkillSelectionOptions {
  /** How many additional skills to promote by useCount (default DEFAULT_CURATED_TOP_N). */
  topN?: number;
  /** Hard cap on the combined curated set (default DEFAULT_CURATED_CAP). */
  cap?: number;
}

export interface CuratedSkillSelectionResult {
  /** Tagged (`tool: true`) skills first, then usage-ranked fill, capped. */
  selected: SkillIndexEntry[];
  /** Skills that would have qualified but were dropped by the hard cap. */
  skipped: SkillIndexEntry[];
}

/**
 * Pure selection: curated = every `tool: true`-tagged skill, PLUS the top-N
 * remaining skills by useCount (ties broken alphabetically for determinism),
 * deduped, then hard-capped — tagged skills always win a slot over
 * usage-ranked ones when the cap would otherwise exclude them, since opting
 * in is a stronger signal than incidental usage.
 */
export function selectCuratedSkillEntries(
  entries: SkillIndexEntry[],
  opts: CuratedSkillSelectionOptions = {},
): CuratedSkillSelectionResult {
  const topN = opts.topN ?? DEFAULT_CURATED_TOP_N;
  const cap = opts.cap ?? DEFAULT_CURATED_CAP;

  const tagged = entries.filter((e) => e.tool === true);
  const taggedNames = new Set(tagged.map((e) => e.name));

  const byUsage = entries
    .filter((e) => !taggedNames.has(e.name))
    .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, topN));

  const combined = [...tagged, ...byUsage];
  const seen = new Set<string>();
  const deduped: SkillIndexEntry[] = [];
  for (const e of combined) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    deduped.push(e);
  }

  return { selected: deduped.slice(0, cap), skipped: deduped.slice(cap) };
}

/**
 * `skill_<name>` sanitization: lowercase, non-alphanumerics collapsed to a
 * single underscore, trimmed, truncated so the prefixed name stays a
 * reasonable tool-name length. Deterministic and collision-checked by the
 * caller (buildCuratedSkillToolDefs), not here — this is pure name-shaping.
 */
export function sanitizeSkillToolName(skillName: string): string {
  const slug = skillName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return `skill_${slug || "skill"}`;
}

export interface CuratedSkillToolDef {
  /** The synthesized MCP tool name, e.g. "skill_triage_inbox". */
  toolName: string;
  /** The original skill name (as stored in the library / passed to skill_run). */
  skillName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Synthesize an MCP tool def per curated skill: each {{param}} becomes a
 * required string property (an unfilled placeholder would otherwise leak
 * literally into the skill's output — see contracts.ts's applySkillParams),
 * plus an optional `input` string property when the skill has a {{input}}
 * slot. Skips (and reports) any skill whose sanitized name collides with a
 * reserved tool name (native lane tools, the four flash-only tools, or an
 * earlier curated skill in the same pass) — collisions are refused, never
 * silently overwritten.
 */
export function buildCuratedSkillToolDefs(
  entries: SkillIndexEntry[],
  reservedNames: ReadonlySet<string>,
): { defs: CuratedSkillToolDef[]; skippedCollisions: string[] } {
  const defs: CuratedSkillToolDef[] = [];
  const skippedCollisions: string[] = [];
  const usedNames = new Set(reservedNames);

  for (const entry of entries) {
    const toolName = sanitizeSkillToolName(entry.name);
    if (usedNames.has(toolName)) {
      skippedCollisions.push(entry.name);
      console.warn(`[flash-mcp] skipping curated skill tool "${toolName}" for skill "${entry.name}" — name collision`);
      continue;
    }
    usedNames.add(toolName);

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const param of entry.params ?? []) {
      properties[param] = { type: "string", description: `Value for the skill's {{${param}}} placeholder.` };
      required.push(param);
    }
    if (entry.hasInput) {
      properties.input = { type: "string", description: "Free-text input for the skill's {{input}} slot." };
    }

    defs.push({
      toolName,
      skillName: entry.name,
      description: entry.description || `Run the "${entry.name}" skill.`,
      inputSchema: { type: "object", properties, required },
    });
  }

  return { defs, skippedCollisions };
}

/** Every native tool name (lane + flash-only) — reserved against skill-tool collisions. */
export function reservedFlashToolNames(): Set<string> {
  return new Set([
    ...LANE_TOOL_DEFINITIONS.map((t) => t.function.name),
    ...FLASH_ONLY_TOOL_NAMES,
  ]);
}

/**
 * Load the library, select the curated set, and synthesize tool defs — the
 * async entry point real callers (loop.ts) use. Kept separate from
 * `prepareFlashMcp` (which stays synchronous for its existing test surface)
 * — callers fetch the curated set once per turn and pass it in.
 */
export async function loadCuratedSkillTools(opts: CuratedSkillSelectionOptions = {}): Promise<CuratedSkillToolDef[]> {
  const { listSkills } = await import("@/lib/skills/store");
  const entries = await listSkills();
  const { selected, skipped } = selectCuratedSkillEntries(entries, opts);
  if (skipped.length) {
    console.log(`[flash-mcp] curated skill-tool cap reached — skipped ${skipped.length} skill(s): ${skipped.map((e) => e.name).join(", ")}`);
  }
  const { defs, skippedCollisions } = buildCuratedSkillToolDefs(selected, reservedFlashToolNames());
  if (skippedCollisions.length) {
    console.warn(`[flash-mcp] skipped ${skippedCollisions.length} curated skill tool(s) — name collision: ${skippedCollisions.join(", ")}`);
  }
  return defs;
}

// ------------------------------------------------------------------
// MCP tool catalog (JSON Schema reuse — the OpenAI function shape's
// `parameters` object is already valid MCP `inputSchema`).
// ------------------------------------------------------------------

export interface FlashMcpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function buildFlashMcpToolCatalog(tools: ChatTool[]): FlashMcpToolDef[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  }));
}

// Bump when FLASH_MCP_SERVER_JS changes so the on-disk copy is rewritten.
export const SERVER_VERSION = "4";

// The stdio MCP server (CommonJS, run by the bundled node). Deliberately avoids
// template literals / ${} so it nests cleanly in this TS array-join string
// (same convention as outbound-mcp.ts). Speaks newline-delimited JSON-RPC 2.0
// and proxies tool calls to the daemon's /bee/:tool (lane tools), /flash/tool/:name
// (Flash-only tools), or — for a curated skill_<name> tool — /bee/skill_run with
// the call's flat arguments repacked into skill_run's {name,params,input} shape
// (SKILL_TOOL_MAP, keyed by the synthesized tool name), all with the daemon auth token.
export const FLASH_MCP_SERVER_JS = [
  "// HiveMatrix flash MCP server (stdio) — generated by flash-mcp.ts. Do not edit.",
  '"use strict";',
  'var fs = require("fs"), os = require("os"), path = require("path"), http = require("http");',
  'var PORT = process.env.HIVE_DAEMON_PORT || "3747";',
  'var TOOLS_FILE = process.env.HIVE_FLASH_TOOLS_FILE || "";',
  'var SKILL_TOOL_MAP_FILE = process.env.HIVE_FLASH_SKILL_TOOL_MAP_FILE || "";',
  'var ALLOWED = (process.env.HIVE_FLASH_ALLOWED || "").split(",").filter(Boolean);',
  'var BRAIN_ROOT = process.env.HIVE_FLASH_BRAIN_ROOT || "";',
  'var PROJECT_PATH = process.env.HIVE_FLASH_PROJECT_PATH || "";',
  'var PROJECT = process.env.HIVE_FLASH_PROJECT || "hivematrix";',
  'var SESSION_ID = process.env.HIVE_FLASH_SESSION_ID || "";',
  'var CHANNEL = process.env.HIVE_FLASH_CHANNEL || "";',
  'var FLASH_ONLY = { persona_update: 1, generate_avatar: 1, deep_think: 1, escalate_to_task: 1, learn_skill: 1 };',
  "function token() {",
  '  try { return fs.readFileSync(path.join(os.homedir(), ".hivematrix", "auth-token"), "utf8").trim(); }',
  '  catch (e) { return ""; }',
  "}",
  "function loadTools() {",
  '  try { return JSON.parse(fs.readFileSync(TOOLS_FILE, "utf8")); }',
  "  catch (e) { return []; }",
  "}",
  // toolName -> original skill name, for curated skill_<name> tools synthesized
  // by buildCuratedSkillToolDefs. Missing/empty file (no curated skills this
  // pass, or an older config) just yields no mappings — never throws.
  "function loadSkillToolMap() {",
  '  try { return JSON.parse(fs.readFileSync(SKILL_TOOL_MAP_FILE, "utf8")); }',
  "  catch (e) { return {}; }",
  "}",
  "var SKILL_TOOL_MAP = loadSkillToolMap();",
  // HARD dispatch-time gate: a name not present in ALLOWED is refused, no
  // matter what tools/list advertised or what --allowedTools offered the
  // model. An intentionally empty ALLOWED denies everything (fail closed).
  "function isAllowed(name) { return ALLOWED.indexOf(name) !== -1; }",
  "function postJson(route, bodyObj) {",
  "  return new Promise(function (resolve) {",
  "    var body = JSON.stringify(bodyObj);",
  "    var req = http.request(",
  '      { host: "127.0.0.1", port: PORT, path: route, method: "POST",',
  '        headers: { "Content-Type": "application/json",',
  '                   "Content-Length": Buffer.byteLength(body),',
  '                   "Authorization": "Bearer " + token() } },',
  '      function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () { resolve(d || "{}"); }); }',
  "    );",
  '    req.on("error", function (e) { resolve(JSON.stringify({ ok: false, result: "daemon unreachable: " + (e && e.message) })); });',
  "    req.write(body); req.end();",
  "  });",
  "}",
  "function extractResult(raw) {",
  "  try {",
  "    var parsed = JSON.parse(raw);",
  '    if (typeof parsed.result === "string") return parsed.result;',
  "    return raw;",
  "  } catch (e) { return raw; }",
  "}",
  // A curated skill_<name> call arrives with the skill's flattened {{params}}
  // (+ optional `input`) as top-level call args — repack into skill_run's
  // real shape ({name, params, input}) and dispatch through the SAME /bee
  // route + capability gate skill_run itself uses, so a curated tool is never
  // a back door around skill_run's trust/probation/scanner checks.
  "function callSkillTool(skillName, a) {",
  "  var params = {}; var input;",
  "  for (var k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { if (k === \"input\") input = a[k]; else params[k] = a[k]; } }",
  "  var skillArgs = { name: skillName, params: params };",
  '  if (input !== undefined) skillArgs.input = input;',
  '  return postJson("/bee/skill_run", { args: skillArgs, projectPath: PROJECT_PATH, project: PROJECT }).then(extractResult);',
  "}",
  "function callTool(name, a) {",
  "  if (!isAllowed(name)) {",
  '    return Promise.resolve("Error: tool " + name + " is not permitted in this pass");',
  "  }",
  "  if (SKILL_TOOL_MAP[name]) {",
  "    return callSkillTool(SKILL_TOOL_MAP[name], a);",
  "  }",
  "  if (FLASH_ONLY[name]) {",
  '    return postJson("/flash/tool/" + name, { args: a, brainRoot: BRAIN_ROOT, sessionId: SESSION_ID, channel: CHANNEL }).then(extractResult);',
  "  }",
  '  return postJson("/bee/" + name, { args: a, projectPath: PROJECT_PATH, project: PROJECT }).then(extractResult);',
  "}",
  "function send(msg) { process.stdout.write(JSON.stringify(msg) + String.fromCharCode(10)); }",
  "function handle(line) {",
  "  var msg; try { msg = JSON.parse(line); } catch (e) { return; }",
  "  var id = msg.id, method = msg.method;",
  '  if (method === "initialize") {',
  '    send({ jsonrpc: "2.0", id: id, result: { protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "flash", version: "1.0.0" } } });',
  "    return;",
  "  }",
  '  if (method === "notifications/initialized" || method === "initialized") return;',
  '  if (method === "ping") { send({ jsonrpc: "2.0", id: id, result: {} }); return; }',
  '  if (method === "tools/list") { send({ jsonrpc: "2.0", id: id, result: { tools: loadTools() } }); return; }',
  '  if (method === "tools/call") {',
  "    var p = msg.params || {};",
  "    if (!isAllowed(p.name)) {",
  '      send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: "Error: tool " + p.name + " is not permitted in this pass" }], isError: true } });',
  "      return;",
  "    }",
  "    Promise.resolve(callTool(p.name, p.arguments || {})).then(function (out) {",
  '      send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: String(out) }] } });',
  '    }).catch(function (e) { send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: "Error: " + String(e && e.message || e) }], isError: true } }); });',
  "    return;",
  "  }",
  '  if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id: id, error: { code: -32601, message: "method not found: " + method } });',
  "}",
  'var buf = "";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", function (chunk) {',
  "  buf += chunk; var idx;",
  '  while ((idx = buf.indexOf(String.fromCharCode(10))) >= 0) {',
  "    var line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);",
  "    if (line) handle(line);",
  "  }",
  "});",
  'process.stdin.on("end", function () { process.exit(0); });',
].join("\n");

/** Directory holding the generated server + config + tools catalog. */
function mcpDir(): string {
  return join(homedir(), ".hivematrix", "mcp");
}

/** Write the server to disk if missing/stale; return its absolute path. Idempotent. */
export function ensureFlashMcpServer(): string {
  const dir = mcpDir();
  mkdirSync(dir, { recursive: true });
  const serverPath = join(dir, "flash-server.cjs");
  const stampPath = join(dir, ".flash-version");
  let current = "";
  try { current = readFileSync(stampPath, "utf8").trim(); } catch { /* first run */ }
  if (current !== SERVER_VERSION) {
    writeFileSync(serverPath, FLASH_MCP_SERVER_JS + "\n", { mode: 0o600 });
    writeFileSync(stampPath, SERVER_VERSION, { mode: 0o600 });
  }
  return serverPath;
}

export interface FlashMcpOptions {
  /** When set, only tools passing the filter are OFFERED and PERMITTED for this pass. */
  allowedTools?: (name: string) => boolean;
  brainRoot: string | null;
  ctx: LaneToolContext;
  sessionId: string;
  /** The real per-surface channel for THIS turn (e.g. "voice", "console") —
   *  forwarded to the MCP child as HIVE_FLASH_CHANNEL and posted back on
   *  every /flash/tool/:name call, so escalate_to_task/learn_skill can key
   *  off the actual request surface instead of the (possibly unified)
   *  session row channel. See store.ts's storageChannel. */
  channel?: string;
  /** Curated skill-as-tool defs for this pass (see loadCuratedSkillTools) —
   *  pre-computed by the caller since skill listing is async and this
   *  function stays synchronous. Defaults to none (no curated skill tools
   *  offered — skill_run remains the only way to reach any skill). */
  curatedSkillTools?: CuratedSkillToolDef[];
}

/**
 * Materialize the server + the tools catalog + the mcp-config file, returning
 * the config path (for `--mcp-config`) and the ALLOWED tool names, namespaced
 * for `--allowedTools`. `nodePath` defaults to the running node so it's valid
 * in dev and in the packaged bundle.
 */
export function prepareFlashMcp(
  port: string,
  nodePath: string,
  opts: FlashMcpOptions,
): { configPath: string; toolNames: string[] } {
  const policy = getConnectivityPolicy();
  const curated = opts.curatedSkillTools ?? [];
  const curatedChatTools: ChatTool[] = curated.map((c) => ({
    type: "function",
    function: { name: c.toolName, description: c.description, parameters: c.inputSchema },
  }));
  const allTools: ChatTool[] = [...availableLaneTools(policy), ...FLASH_ONLY_TOOL_DEFS, ...curatedChatTools];
  const allowedNames = opts.allowedTools
    ? allTools.filter((t) => opts.allowedTools!(t.function.name)).map((t) => t.function.name)
    : allTools.map((t) => t.function.name);

  const dir = mcpDir();
  mkdirSync(dir, { recursive: true });

  // tools/list always reflects the FULL capability-gated catalog (not the
  // allow-list) — see file header for why: it makes the allow-list gate
  // independently verifiable (list shows a tool, call still refuses it).
  const toolsFilePath = join(dir, "flash-tools.json");
  writeFileSync(toolsFilePath, JSON.stringify(buildFlashMcpToolCatalog(allTools), null, 2), { mode: 0o600 });

  // toolName -> original skill name, consulted by the generated server's
  // callSkillTool() to repack a curated skill_<name> call into skill_run's
  // real {name,params,input} shape before proxying to /bee/skill_run.
  const skillToolMapPath = join(dir, "flash-skill-tool-map.json");
  const skillToolMap: Record<string, string> = {};
  for (const c of curated) skillToolMap[c.toolName] = c.skillName;
  writeFileSync(skillToolMapPath, JSON.stringify(skillToolMap, null, 2), { mode: 0o600 });

  const serverPath = ensureFlashMcpServer();
  const configPath = join(dir, "flash-mcp-config.json");
  const config = {
    mcpServers: {
      [FLASH_MCP_SERVER_NAME]: {
        command: nodePath,
        args: [serverPath],
        env: {
          HIVE_DAEMON_PORT: port,
          HIVE_FLASH_TOOLS_FILE: toolsFilePath,
          HIVE_FLASH_SKILL_TOOL_MAP_FILE: skillToolMapPath,
          HIVE_FLASH_ALLOWED: allowedNames.join(","),
          HIVE_FLASH_BRAIN_ROOT: opts.brainRoot ?? "",
          HIVE_FLASH_PROJECT_PATH: opts.ctx.projectPath,
          HIVE_FLASH_PROJECT: opts.ctx.project,
          HIVE_FLASH_SESSION_ID: opts.sessionId,
          HIVE_FLASH_CHANNEL: opts.channel ?? "",
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

  return { configPath, toolNames: allowedNames.map(flashToolName) };
}
