/**
 * Voice command executor for the push-to-talk turn — the IO glue that turns a
 * detected command intent into real daemon actions and a spoken reply.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import {
  detectCommandIntent,
  boardReply, approvalsReply, resolvedReply, noApprovalToResolveReply,
  directivesReply, createdTaskReply, connectivityReply, setConnectivityReply,
  type CommandIntent,
} from "./command-intent";
import {
  RollingCommandContextStore,
  rememberApprovalList,
  rememberLastTask,
  rememberTurn,
  resolveApprovalReference,
  type ContextApproval,
} from "./command-context";
import { buildVoiceBriefing, usageReply, type BriefingUsage, type BriefingBrowserReadiness, type BriefingWorkflowInbox } from "./briefing";
import { getWeather, weatherReply, weatherNeedsLocationReply, type WeatherWhen, type WeatherResult } from "./weather";
import { synthesizeSpeech } from "./tts";
import { buildVoiceBrowserLaneTask } from "./browser-lane-intent";
import { buildVoiceMailDeleteTask } from "./mail-delete-intent";
import type { ApprovalQueueItem } from "@/lib/approvals/queue";
import type { DirectiveRow } from "@/lib/orchestrator/directive-store";

interface VoiceTaskRef { _id: string; title: string }
interface VoiceDirectiveRef { _id?: string; goal: string; status: string }
interface OpenClawVoiceRequest { assistant: "vale" | "openclaw"; prompt: string; sessionKey: string }
interface OpenClawVoiceResult {
  ok: boolean;
  available: boolean;
  sessionKey: string;
  runId: string | null;
  reason: string | null;
  /** Populated by the real impl so the handler can start async polling. Absent from test stubs. */
  gatewayUrl?: string | null;
  /** ISO timestamp when the message was sent — cursor for reply polling. */
  sentAt?: string;
}

export interface CommandTurnOverride {
  reply: string;
  audioBase64: string;
  command: { kind: CommandIntent["kind"]; detail?: string; taskId?: string };
}

export interface CommandTurnDeps {
  sessionId?: string;
  synthesize?: (text: string) => Promise<string>;
  buildApprovalQueue?: () => Promise<ApprovalQueueItem[]> | ApprovalQueueItem[];
  resolveApproval?: (taskId: string, timestamp: string, decision: "approve" | "done" | "denied", via: string) => Promise<void>;
  listDirectives?: () => Promise<VoiceDirectiveRef[]> | VoiceDirectiveRef[];
  updateDirective?: (id: string, fields: Record<string, unknown>) => Promise<void> | void;
  createTask?: (payload: Record<string, unknown>) => Promise<VoiceTaskRef>;
  listFailedTasks?: () => Promise<VoiceTaskRef[]> | VoiceTaskRef[];
  retryTask?: (id: string) => Promise<void> | void;
  updateTaskModel?: (id: string, model: string) => Promise<{ title: string } | null>;
  getUsage?: () => Promise<BriefingUsage | null>;
  getMetrics?: () => Promise<Record<string, unknown>>;
  getBrowserReadiness?: () => Promise<BriefingBrowserReadiness | null> | BriefingBrowserReadiness | null;
  getWorkflowInbox?: () => Promise<BriefingWorkflowInbox | null> | BriefingWorkflowInbox | null;
  askOpenClaw?: (request: OpenClawVoiceRequest) => Promise<OpenClawVoiceResult>;
  /** Poll for the next OpenClaw assistant reply after sentAfter. */
  pollOpenClawReply?: (opts: { gatewayUrl: string; sessionKey: string; sentAfter: string }) => Promise<{ found: boolean; text: string | null; reason: string | null }>;
  /** Broadcast a named SSE event to connected clients (e.g. voice:result). */
  broadcast?: (event: string, data: unknown) => void;
  /** Operator location from HiveMatrix settings (Personalization). Never agent memory. */
  getLocation?: () => string | null | undefined;
  fetchWeather?: (location: string, when: WeatherWhen) => Promise<WeatherResult>;
  getBoardCounts?: () => Record<string, number>;
  now?: Date;
}

const contextStore = new RollingCommandContextStore();

function parseReminderTimeTodayOrTomorrow(whenText: string, now: Date = new Date()): Date | null {
  const m = whenText.trim().match(/^([0-9]{1,2})(?::([0-9]{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

function formatReminderAt(target: Date): string {
  return target.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function reminderTitle(text: string): string {
  const base = text.length > 70 ? text.slice(0, 67).trimEnd() + "..." : text;
  return `Reminder: ${base}`;
}

/**
 * Gather the operator standup and render it to one spoken/notifiable string.
 * Shared by the "good morning" voice command and the scheduled morning push so
 * both read the same data and phrasing.
 */
export async function composeBriefing(deps: CommandTurnDeps = {}): Promise<string> {
  const [approvals, directives, failedTasks, usage, browserReadiness, workflowInbox] = await Promise.all([
    approvalQueue(deps),
    listDirectives(deps),
    listFailedTasks(deps),
    getUsage(deps),
    getBrowserReadiness(deps),
    getWorkflowInboxCounts(deps),
  ]);
  return buildVoiceBriefing({
    approvals: approvals.map((item) => ({ title: item.title, kind: item.kind })),
    failedTasks: failedTasks.map((task) => ({ title: task.title })),
    directives: directives.map((d) => ({ goal: d.goal, status: d.status })),
    usage,
    browserReadiness,
    workflowInbox,
  });
}

/**
 * Workflow Inbox counts for the briefing — read-only over the run/action ledger.
 * Counts only (reviews / ready / blocked / attention); never executes, never leaks
 * artifact content. Degrades to null if the inbox is unavailable.
 */
async function getWorkflowInboxCounts(deps: CommandTurnDeps): Promise<BriefingWorkflowInbox | null> {
  if (deps.getWorkflowInbox) return deps.getWorkflowInbox();
  try {
    const { getWorkflowInbox } = await import("@/lib/workflows/inbox");
    const c = getWorkflowInbox().counts;
    return {
      needsReview: c.needs_review + c.changes_requested,
      ready: c.proposed_actions_ready,
      blocked: c.proposed_actions_blocked,
      attention: c.failed_or_attention,
    };
  } catch {
    return null;
  }
}

/**
 * Browser Lane readiness for the briefing — counts the sites needing attention
 * (red + orange + gray/unknown) and surfaces the top few. Metadata only.
 */
async function getBrowserReadiness(deps: CommandTurnDeps): Promise<BriefingBrowserReadiness | null> {
  if (deps.getBrowserReadiness) return deps.getBrowserReadiness();
  try {
    const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
    const { getBrowserLaneReadinessDashboard } = await import("@/lib/browser-lane/store");
    const config = getBrowserLaneReadinessConfig();
    const dash = getBrowserLaneReadinessDashboard({ staleAfterHours: config.staleAfterHours });
    const attention = dash.sites.filter((s) => ["red", "orange", "gray"].includes(s.readiness.color));
    return {
      needsAttention: attention.length,
      byColor: dash.totals.byColor,
      staleCount: dash.totals.stale,
      lastSweepAt: config.lastRunAt ?? null,
      topSites: attention.slice(0, 3).map((s) => ({
        name: s.displayName,
        color: s.readiness.color,
        status: s.readiness.status,
        siteId: s.id,
        traceRunId: s.readiness.traceRunId,
      })),
    };
  } catch {
    return null; // briefing degrades gracefully if the dashboard is unavailable
  }
}

/** Resolve a detected command to a spoken answer, performing any action. */
export async function commandTurnOverride(transcript: string, deps: CommandTurnDeps = {}): Promise<CommandTurnOverride | null> {
  const intent = detectCommandIntent(transcript || "");
  if (intent.kind === "none") return null;

  let result: { reply: string; taskId?: string; detail?: string } | null = null;
  const sessionId = deps.sessionId ?? "default";
  try {
    result = await runCommand(intent, deps, sessionId);
  } catch (e) {
    console.error(`[voice-cmd] ${intent.kind} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (result == null) return null;

  contextStore.update(sessionId, (ctx) => rememberTurn(ctx, { kind: intent.kind, text: transcript }));

  let audioBase64 = "";
  try {
    const path = deps.synthesize ? await deps.synthesize(result.reply) : (await synthesizeSpeech(result.reply)).path;
    audioBase64 = path ? readFileSync(path).toString("base64") : "";
  } catch { /* speak-less fallback: the client shows the text reply */ }

  return { reply: result.reply, audioBase64, command: { kind: intent.kind, detail: result.detail, taskId: result.taskId } };
}

async function runCommand(intent: CommandIntent, deps: CommandTurnDeps, sessionId: string): Promise<{ reply: string; taskId?: string; detail?: string } | null> {
  const r = (reply: string, taskId?: string, detail?: string) => ({ reply, taskId, detail });
  switch (intent.kind) {
    case "board": {
      const counts = deps.getBoardCounts ? deps.getBoardCounts() : await boardCounts();
      return r(boardReply(counts));
    }
    case "approvalsList": {
      const items = await approvalQueue(deps);
      contextStore.update(sessionId, (ctx) => rememberApprovalList(ctx, toContextApprovals(items)));
      return r(approvalsReply(items.map((i) => ({ title: i.title, kind: i.kind }))));
    }
    case "approve":
    case "deny": {
      const items = await approvalQueue(deps);
      const resolution = resolveApprovalReference(intent, contextStore.get(sessionId), toContextApprovals(items));
      if (resolution.status === "none") return r(noApprovalToResolveReply());
      if (resolution.status === "ambiguous") return r(disambiguationReply(resolution.choices));
      const decision = intent.kind === "approve" ? "approve" : "denied";
      await resolveApproval(deps, resolution.item.taskId, resolution.item.timestamp, decision);
      return r(resolvedReply(intent.kind === "approve" ? "approve" : "deny", resolution.item.title));
    }
    case "directives": {
      const directives = await listDirectives(deps);
      return r(directivesReply(directives.map((d) => ({ goal: d.goal, status: d.status }))));
    }
    case "briefing": {
      return r(await composeBriefing(deps));
    }
    case "usage": {
      return r(usageReply(await getUsage(deps)));
    }
    case "analytics": {
      const metrics = await getMetrics(deps);
      const tasks = metrics.tasksByStatus as Record<string, number> | undefined;
      const dirs = metrics.directivesByStatus as Record<string, number> | undefined;
      const runs = metrics.runs as { failed?: number; done?: number; total?: number } | undefined;
      return r(`Analytics: ${tasks?.backlog ?? 0} queued tasks, ${tasks?.failed ?? 0} failed, ${dirs?.active ?? 0} active scheduled items, ${runs?.failed ?? 0} failed runs.`);
    }
    case "retryFailedTask": {
      const [task] = await listFailedTasks(deps);
      if (!task) return r("No failed tasks to retry.");
      await retryTask(deps, task._id);
      return r(`Retrying ${task.title}.`, task._id);
    }
    case "setTaskModel": {
      if (!intent.taskRef || !intent.model) return r("Tell me the task and model to use.");
      const task = await updateTaskModel(deps, intent.taskRef, intent.model);
      if (!task) return r(`I couldn't find task ${intent.taskRef}.`);
      return r(`Set ${task.title} to ${intent.model}.`, intent.taskRef);
    }
    case "startDirective":
    case "pauseDirective": {
      const directive = findDirective(await listDirectives(deps), intent.directiveText ?? "");
      if (!directive?._id) return r(`I couldn't find scheduled item ${intent.directiveText ?? ""}.`);
      const status = intent.kind === "startDirective" ? "active" : "sleeping";
      await updateDirective(deps, directive._id, { status });
      return r(`${intent.kind === "startDirective" ? "Started" : "Paused"} scheduled item: ${directive.goal}.`);
    }
    case "triggerReleaseVerification": {
      const task = await createTask(deps, {
        title: "Release verification",
        description: "Run HiveMatrix release verification and report whether autoupdate is ready.\n\nCommand: npm run release:verify",
        project: "hivematrix",
        projectPath: process.cwd(),
        status: "backlog",
        executor: "agent",
        source: "voice",
      });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r("I queued release verification.", task._id);
    }
    case "browserLaneTask": {
      if (!intent.browserLane) return null;
      console.log(`[voice-cmd] browserLaneTask: mode=${intent.browserLane.mode}`);
      const payload = buildVoiceBrowserLaneTask(intent.browserLane, { titlePrefix: "Voice" });
      const task = await createTask(deps, { ...payload });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(`I queued Browser Lane ${intent.browserLane.mode}.`, task._id);
    }
    case "mailDeleteTask": {
      if (!intent.mailDelete) return null;
      const payload = buildVoiceMailDeleteTask(intent.mailDelete);
      const task = await createTask(deps, { ...payload });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(`I queued a Mail Lane deletion review for ${intent.mailDelete.query}. No email has been deleted.`, task._id);
    }
    case "openclawAsk": {
      if (!intent.openclaw) return null;
      const { assistant } = intent.openclaw;
      const result = await askOpenClaw(deps, intent.openclaw);
      const displayName = assistant === "vale" ? "Vale" : "OpenClaw";
      if (!result.ok) {
        return r(
          `I couldn't reach ${displayName}: ${result.reason ?? "OpenClaw is unavailable."}`,
          undefined,
          `openclaw:${assistant}:unavailable`,
        );
      }
      // Async path: poll for Vale's reply in the background and broadcast voice:result when ready.
      if (result.gatewayUrl && result.sentAt) {
        void deliverOpenClawReply({
          deps,
          sessionId,
          gatewayUrl: result.gatewayUrl,
          sessionKey: result.sessionKey,
          sentAfter: result.sentAt,
          assistant,
        });
      }
      return r(
        `I asked ${displayName}. I'll read it back when it's ready.`,
        undefined,
        `openclaw:${assistant}:${result.runId ?? "sent"}`,
      );
    }
    case "weather": {
      const when = intent.weatherWhen ?? "today";
      const location = (intent.weatherCity || "").trim() || await operatorLocation(deps);
      if (!location) return r(weatherNeedsLocationReply(), undefined, "needs-location");
      const result = await fetchWeather(deps, location, when);
      if (!result.ok) return r(`I couldn't get the weather for ${location} right now.`, undefined, "weather-error");
      return r(weatherReply(result.report), undefined, "weather");
    }
    case "scheduledReminder": {
      const text = (intent.reminderText || "").trim();
      const whenText = (intent.reminderWhenText || "").trim();
      if (!text || !whenText) return null;
      const target = parseReminderTimeTodayOrTomorrow(whenText, deps.now ?? new Date());
      if (!target) return r(`I heard the reminder, but I couldn't understand the time: ${whenText}.`, undefined, "reminder-time-error");
      const runAt = target.toISOString();
      const title = reminderTitle(text);
      const { DEFAULT_TASK_PROJECT } = await import("@/lib/routing/project-constants");
      const task = await createTask(deps, {
        title,
        description: [
          `Voice reminder scheduled for ${formatReminderAt(target)} (${runAt}).`,
          "",
          `Reminder: ${text}`,
          "",
          "This is a direct Voice Lane delayed reminder. HiveMatrix stores it with delayUntil so no agent needs to run until the reminder time.",
        ].join("\n"),
        project: DEFAULT_TASK_PROJECT,
        projectPath: homedir(),
        status: "backlog",
        executor: "agent",
        source: "voice",
        delayUntil: runAt,
        output: { voiceReminder: { text, whenText, runAt } },
      });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(`Scheduled reminder for ${formatReminderAt(target)}: ${text}.`, task._id, "scheduled-reminder");
    }
    case "createTask": {
      const text = (intent.taskText || "").trim();
      if (!text) return null;
      const { DEFAULT_TASK_PROJECT } = await import("@/lib/routing/project-constants");
      const title = text.length > 60 ? text.slice(0, 57).trimEnd() + "…" : text;
      const task = await createTask(deps, {
        title,
        description: text,
        project: DEFAULT_TASK_PROJECT,
        projectPath: homedir(),
        status: "backlog",
        executor: "agent",
        source: "voice",
      });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(createdTaskReply(title), task._id);
    }
    case "connectivity": {
      const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
      return r(connectivityReply(getConnectivityPolicy().mode));
    }
    case "setConnectivity": {
      const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
      const mode = intent.mode ?? "auto";
      getConnectivityPolicy().setManualOverride(mode === "auto" ? null : mode, "voice command");
      return r(setConnectivityReply(mode));
    }
    default:
      return null;
  }
}

/** Operator location from HiveMatrix settings (Personalization) — never agent memory. */
async function operatorLocation(deps: CommandTurnDeps): Promise<string> {
  if (deps.getLocation) return (deps.getLocation() || "").trim();
  const { getLocation } = await import("@/lib/models/available");
  return (getLocation() || "").trim();
}

async function fetchWeather(deps: CommandTurnDeps, location: string, when: WeatherWhen): Promise<WeatherResult> {
  if (deps.fetchWeather) return deps.fetchWeather(location, when);
  return getWeather(location, when);
}

/** Voice preface so Vale answers concisely for spoken delivery. */
function openclawVoiceMessage(prompt: string): string {
  return `The operator asked by voice through HiveMatrix. Answer concisely because the response may be spoken aloud. If you need email access, use the available OpenClaw/HiveMatrix lane tools or browser workflow rather than asking the operator to manually summarize. Request: ${prompt}`;
}

async function askOpenClaw(deps: CommandTurnDeps, request: OpenClawVoiceRequest): Promise<OpenClawVoiceResult> {
  if (deps.askOpenClaw) return deps.askOpenClaw(request);

  const { isFeatureEnabled } = await import("@/lib/config/features");
  if (!isFeatureEnabled("openclaw.chatDock")) {
    return {
      ok: false,
      available: false,
      sessionKey: request.sessionKey,
      runId: null,
      reason: "OpenClaw Chat Dock is disabled.",
    };
  }

  const { discoverOpenclaw } = await import("@/lib/openclaw/discovery");
  const discovery = await discoverOpenclaw();
  if (!discovery.available || !discovery.gateway) {
    return {
      ok: false,
      available: false,
      sessionKey: request.sessionKey,
      runId: null,
      reason: discovery.reason ?? "OpenClaw Gateway is not reachable.",
    };
  }

  const { sendChatMessage } = await import("@/lib/openclaw/bridge");
  const sentAt = new Date().toISOString();
  const message = openclawVoiceMessage(request.prompt);
  const sendResult = await sendChatMessage({
    gatewayUrl: discovery.gateway.url,
    sessionKey: request.sessionKey,
    message,
  });
  return { ...sendResult, gatewayUrl: discovery.gateway.url, sentAt };
}

const MAX_SPOKEN_OPENCLAW_CHARS = 600;

/** Cap and clean OpenClaw text for spoken delivery. */
function capOpenClawText(text: string): string {
  const clean = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > MAX_SPOKEN_OPENCLAW_CHARS
    ? clean.slice(0, MAX_SPOKEN_OPENCLAW_CHARS - 1).trimEnd() + "…"
    : clean;
}

function defaultOpenClawBroadcast(event: string, data: unknown): void {
  void import("@/lib/ws/broadcaster").then(({ broadcastEvent }) => broadcastEvent(event, data));
}

async function pollOpenClaw(
  deps: CommandTurnDeps,
  opts: { gatewayUrl: string; sessionKey: string; sentAfter: string },
): Promise<{ found: boolean; text: string | null; reason: string | null }> {
  if (deps.pollOpenClawReply) return deps.pollOpenClawReply(opts);
  const { pollForAssistantReply } = await import("@/lib/openclaw/bridge");
  return pollForAssistantReply(opts);
}

/**
 * Background async path: poll for the assistant reply after sending, then
 * synthesize and broadcast voice:result. Never throws — voice turn already acked.
 */
async function deliverOpenClawReply(opts: {
  deps: CommandTurnDeps;
  sessionId: string;
  gatewayUrl: string;
  sessionKey: string;
  sentAfter: string;
  assistant: "vale" | "openclaw";
}): Promise<void> {
  const { deps, sessionId, gatewayUrl, sessionKey, sentAfter, assistant } = opts;
  const displayName = assistant === "vale" ? "Vale" : "OpenClaw";
  let pollResult: { found: boolean; text: string | null; reason: string | null };
  try {
    pollResult = await pollOpenClaw(deps, { gatewayUrl, sessionKey, sentAfter });
  } catch (e) {
    pollResult = { found: false, text: null, reason: e instanceof Error ? e.message : "poll failed" };
  }

  const raw = pollResult.found && pollResult.text ? pollResult.text : null;
  const text = raw
    ? capOpenClawText(raw)
    : `${displayName} didn't respond in time. Check the OpenClaw Chat Dock for details.`;

  let audioBase64 = "";
  try {
    const path = deps.synthesize
      ? await deps.synthesize(text)
      : (await synthesizeSpeech(text)).path;
    audioBase64 = path ? readFileSync(path).toString("base64") : "";
  } catch { /* speak-less fallback */ }

  const broadcastFn = deps.broadcast ?? defaultOpenClawBroadcast;
  broadcastFn("voice:result", { sessionId, text, audioBase64, ok: pollResult.found });
}

async function boardCounts(): Promise<Record<string, number>> {
  const { Task } = await import("@/lib/db");
  return Task.countByStatus();
}

async function approvalQueue(deps: CommandTurnDeps): Promise<ApprovalQueueItem[]> {
  if (deps.buildApprovalQueue) return await deps.buildApprovalQueue();
  const { buildApprovalQueue } = await import("@/lib/approvals/queue");
  return buildApprovalQueue();
}

function toContextApprovals(items: ApprovalQueueItem[]): ContextApproval[] {
  return items.map((item) => ({
    kind: item.kind,
    taskId: item.taskId,
    timestamp: item.timestamp,
    title: item.title,
  }));
}

async function resolveApproval(deps: CommandTurnDeps, taskId: string, timestamp: string, decision: "approve" | "denied"): Promise<void> {
  if (deps.resolveApproval) return deps.resolveApproval(taskId, timestamp, decision, "voice");
  const { resolveApproval } = await import("@/lib/orchestrator/approval");
  await resolveApproval(taskId, timestamp, decision, "voice");
}

async function listDirectives(deps: CommandTurnDeps): Promise<VoiceDirectiveRef[]> {
  if (deps.listDirectives) return await deps.listDirectives();
  const { listDirectives } = await import("@/lib/orchestrator/directive-store");
  return listDirectives();
}

async function updateDirective(deps: CommandTurnDeps, id: string, fields: Record<string, unknown>): Promise<void> {
  if (deps.updateDirective) return void await deps.updateDirective(id, fields);
  const { updateDirective } = await import("@/lib/orchestrator/directive-store");
  updateDirective(id, fields as Partial<DirectiveRow>);
}

async function createTask(deps: CommandTurnDeps, payload: Record<string, unknown>): Promise<VoiceTaskRef> {
  if (deps.createTask) return deps.createTask(payload);
  const { Task, generateId } = await import("@/lib/db");
  const task = await Task.create({ _id: generateId(), ...payload });
  return { _id: task._id, title: task.title };
}

async function listFailedTasks(deps: CommandTurnDeps): Promise<VoiceTaskRef[]> {
  if (deps.listFailedTasks) return await deps.listFailedTasks();
  const { Task } = await import("@/lib/db");
  return (await Task.find({ status: "failed" }).sort({ updatedAt: -1 }).limit(5)).map((t) => ({ _id: t._id, title: t.title }));
}

async function retryTask(deps: CommandTurnDeps, id: string): Promise<void> {
  if (deps.retryTask) return void await deps.retryTask(id);
  const { Task } = await import("@/lib/db");
  await Task.findByIdAndUpdate(id, { status: "backlog", error: null, agentPid: null, startedAt: null, completedAt: null, reviewState: null });
}

async function updateTaskModel(deps: CommandTurnDeps, id: string, model: string): Promise<{ title: string } | null> {
  if (deps.updateTaskModel) return deps.updateTaskModel(id, model);
  const { Task } = await import("@/lib/db");
  return Task.findByIdAndUpdate(id, { model });
}

async function getUsage(deps: CommandTurnDeps): Promise<BriefingUsage | null> {
  if (deps.getUsage) return deps.getUsage();
  const { getFrontierUsage } = await import("@/lib/usage/frontier-usage");
  const usage = await getFrontierUsage();
  const sub = usage.subscription;
  const window = sub?.fiveHour ?? sub?.sevenDay ?? sub?.sevenDayOpus ?? sub?.sevenDaySonnet ?? null;
  const subscriptionPercentRemaining = typeof window?.remaining === "number" ? window.remaining : null;
  return {
    totalCost: usage.totalCost,
    todayCost: usage.todayCost,
    taskCount: usage.taskCount,
    todayTaskCount: usage.todayTaskCount,
    subscriptionPercentRemaining,
  };
}

async function getMetrics(deps: CommandTurnDeps): Promise<Record<string, unknown>> {
  if (deps.getMetrics) return deps.getMetrics();
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const taskRows = db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all() as Array<{ status: string; n: number }>;
  const dirRows = db.prepare("SELECT status, COUNT(*) as n FROM directives GROUP BY status").all() as Array<{ status: string; n: number }>;
  const toMap = (rows: Array<{ status: string; n: number }>) => Object.fromEntries(rows.map((row) => [row.status, row.n]));
  const runs = db.prepare("SELECT phase, COUNT(*) as n FROM runs GROUP BY phase").all() as Array<{ phase: string; n: number }>;
  return {
    tasksByStatus: toMap(taskRows),
    directivesByStatus: toMap(dirRows),
    runs: {
      failed: runs.find((row) => row.phase === "failed")?.n ?? 0,
      done: runs.find((row) => row.phase === "done")?.n ?? 0,
      total: runs.reduce((sum, row) => sum + row.n, 0),
    },
  };
}

function findDirective(
  directives: VoiceDirectiveRef[],
  query: string,
): VoiceDirectiveRef | null {
  const q = query.toLowerCase().trim();
  return directives.find((d) => d.goal.toLowerCase().includes(q)) ?? null;
}

function disambiguationReply(choices: ContextApproval[]): string {
  const visible = choices.slice(0, 3).map((item, index) => `${index + 1}: ${item.title}`).join("; ");
  return `Which approval should I resolve? Say first, second, or third. ${visible}.`;
}
