import { commandTurnOverride, type CommandTurnDeps } from "./command-turn";
import { routeVoiceSession, type VoiceSession } from "./session";
import { skillTurnOverride } from "./skill-turn";
import { getWeather, type WeatherResult, type WeatherWhen } from "./weather";
import type { Skill, SkillIndexEntry } from "@/lib/skills/contracts";
import type { ApprovalQueueItem } from "@/lib/approvals/queue";

export interface VoiceLogicScenarioResult {
  name: string;
  utterance: string;
  expected: string;
  actual: string;
  passed: boolean;
  reply: string;
  audioBytes: number;
  sideEffects: string[];
}

export interface VoiceLogicScenarioRun {
  ok: boolean;
  passed: number;
  failed: number;
  scenarios: VoiceLogicScenarioResult[];
  ranAt: string;
}

export interface VoiceLogicScenarioOptions {
  now?: () => string;
  /** Use the real keyless weather provider. Read-only; all mutating actions stay simulated. */
  liveWeather?: boolean;
  location?: string;
  fetchWeather?: (location: string, when: WeatherWhen) => Promise<WeatherResult>;
}

type ScenarioKind = "skill" | "command" | "handoff";

interface Scenario {
  name: string;
  utterance: string;
  kind: ScenarioKind;
  expected: string;
  prime?: (deps: ScenarioDeps) => Promise<void>;
}

interface ScenarioDeps {
  command: CommandTurnDeps;
  skill: Parameters<typeof skillTurnOverride>[1];
  sideEffects: string[];
}

const approvals: ApprovalQueueItem[] = [
  { kind: "checkpoint", taskId: "approval-1", timestamp: "checkpoint-plan", title: "Review launch plan", detail: "", options: ["approve", "deny"] },
];

const skillIndex: SkillIndexEntry = {
  name: "deploy-release",
  description: "Ship a release",
  tags: ["release"],
  useCount: 3,
  compat: ["all"],
  hasInput: false,
  trusted: true,
  kind: "instruction",
  roles: [],
};

const skillBody: Skill = {
  name: "deploy-release",
  description: "Ship a release",
  tags: ["release"],
  body: "Ship the release safely.",
  source: "diagnostic",
  trusted: true,
  kind: "instruction",
  interpreter: "bash",
  useCount: 3,
  revisions: 1,
  createdAt: "2026-06-27T00:00:00.000Z",
  updatedAt: "2026-06-27T00:00:00.000Z",
  lastUsedAt: "",
  compat: ["all"],
  scope: "personal",
  scanVerdict: "pass",
  roles: [],
  failures: 0,
  probation: false,
};

const scenarios: Scenario[] = [
  { name: "skill listing", utterance: "what skills do I have", kind: "skill", expected: "skill:list" },
  { name: "skill search release", utterance: "find a skill for release", kind: "skill", expected: "skill:list" },
  { name: "skill use deploy release", utterance: "use the deploy release skill", kind: "skill", expected: "skill:use" },
  { name: "briefing", utterance: "good morning", kind: "command", expected: "command:briefing" },
  { name: "brief me", utterance: "brief me on what needs attention", kind: "command", expected: "command:briefing" },
  { name: "standup", utterance: "status briefing", kind: "command", expected: "command:briefing" },
  { name: "board overview", utterance: "what's on my board", kind: "command", expected: "command:board" },
  { name: "running tasks", utterance: "what's running", kind: "command", expected: "command:board" },
  { name: "task status", utterance: "task status report", kind: "command", expected: "command:board" },
  { name: "approvals list", utterance: "anything to approve", kind: "command", expected: "command:approvalsList" },
  { name: "pending approvals", utterance: "what approvals are pending", kind: "command", expected: "command:approvalsList" },
  { name: "needs my approval", utterance: "what needs my approval", kind: "command", expected: "command:approvalsList" },
  { name: "weather", utterance: "what's the weather today", kind: "command", expected: "command:weather" },
  { name: "weather saved Kings Mills", utterance: "what's the weather today", kind: "command", expected: "command:weather" },
  { name: "weather tomorrow", utterance: "weather tomorrow", kind: "command", expected: "command:weather" },
  { name: "forecast", utterance: "what's the forecast", kind: "command", expected: "command:weather" },
  { name: "umbrella", utterance: "do I need an umbrella", kind: "command", expected: "command:weather" },
  { name: "rain", utterance: "is it going to rain today", kind: "command", expected: "command:weather" },
  { name: "weather inline city", utterance: "what's the weather in Paris", kind: "command", expected: "command:weather" },
  { name: "usage summary", utterance: "usage summary", kind: "command", expected: "command:usage" },
  { name: "frontier usage", utterance: "frontier usage status", kind: "command", expected: "command:usage" },
  { name: "token report", utterance: "token usage report", kind: "command", expected: "command:usage" },
  { name: "analytics", utterance: "analytics", kind: "command", expected: "command:analytics" },
  { name: "metrics", utterance: "show metrics", kind: "command", expected: "command:analytics" },
  { name: "directives", utterance: "what are my directives", kind: "command", expected: "command:directives" },
  { name: "standing goals", utterance: "what standing goals are active", kind: "command", expected: "command:directives" },
  { name: "watching", utterance: "what are you watching", kind: "command", expected: "command:directives" },
  { name: "retry failed", utterance: "retry failed task", kind: "command", expected: "command:retryFailedTask" },
  { name: "rerun last failed", utterance: "rerun the last failed", kind: "command", expected: "command:retryFailedTask" },
  { name: "set task model", utterance: "set task abc123 to qwen", kind: "command", expected: "command:setTaskModel" },
  { name: "use model for task", utterance: "use claude for task task42", kind: "command", expected: "command:setTaskModel" },
  { name: "start directive", utterance: "start directive release watcher", kind: "command", expected: "command:startDirective" },
  { name: "resume directive", utterance: "resume directive inbox sweep", kind: "command", expected: "command:startDirective" },
  { name: "pause directive", utterance: "pause directive release watcher", kind: "command", expected: "command:pauseDirective" },
  { name: "stop directive", utterance: "stop directive inbox sweep", kind: "command", expected: "command:pauseDirective" },
  { name: "release verification", utterance: "trigger release verification", kind: "command", expected: "command:triggerReleaseVerification" },
  { name: "run release verify", utterance: "run release verification", kind: "command", expected: "command:triggerReleaseVerification" },
  { name: "browser lane task", utterance: "use browser lane to search Tesla Model S price", kind: "command", expected: "command:browserLaneTask" },
  { name: "browser lane read", utterance: "use browser lane to read apple developer news", kind: "command", expected: "command:browserLaneTask" },
  { name: "browser lane open", utterance: "use browser lane to open TestFlight", kind: "command", expected: "command:browserLaneTask" },
  { name: "browser search competitor", utterance: "search the web for best solo founder CRMs", kind: "command", expected: "command:browserLaneTask" },
  { name: "browser research school", utterance: "research summer camps near me in browser lane", kind: "command", expected: "command:browserLaneTask" },
  { name: "browser inspect app store", utterance: "browser lane check app store connect status", kind: "command", expected: "command:browserLaneTask" },
  { name: "mail delete review", utterance: "delete the latest email from Stripe", kind: "command", expected: "command:mailDeleteTask" },
  { name: "mail trash newsletter", utterance: "trash the newsletter from Acme", kind: "command", expected: "command:mailDeleteTask" },
  { name: "mail delete receipt", utterance: "delete the receipt email from Apple", kind: "command", expected: "command:mailDeleteTask" },
  { name: "mail remove promo", utterance: "remove the latest promo email", kind: "command", expected: "command:mailDeleteTask" },
  { name: "mail delete calendar", utterance: "delete the calendar invite from vendor", kind: "command", expected: "command:mailDeleteTask" },
  { name: "create investor task", utterance: "create a task to draft the investor update", kind: "command", expected: "command:createTask" },
  { name: "create invoice task", utterance: "make a task to reconcile invoices", kind: "command", expected: "command:createTask" },
  // "remind me …" sets a REAL Apple Reminder (scheduledReminder), never a
  // do-nothing HiveMatrix task (regression 2026-07-12). "remember to …" (no
  // "remind me"/"set a reminder" prefix) still routes to createTask.
  { name: "remind school form", utterance: "remind me to submit the school form tomorrow", kind: "command", expected: "command:scheduledReminder" },
  { name: "remember dentist", utterance: "remember to book the dentist appointment", kind: "command", expected: "command:createTask" },
  { name: "personal grocery", utterance: "remind me to add milk to the grocery list", kind: "command", expected: "command:scheduledReminder" },
  { name: "team followup", utterance: "make sure to follow up with Alex about the proposal", kind: "command", expected: "command:createTask" },
  { name: "new task taxes", utterance: "new task for quarterly taxes", kind: "command", expected: "command:createTask" },
  // Self-improvement utterances must fall through to Flash (kind: none), never
  // be swallowed by createTask or any other generic intent — Flash escalates
  // these agentically via escalate_to_task (P3.2).
  { name: "self-improvement update calendar", utterance: "update HiveMatrix so it can read my calendar", kind: "command", expected: "none" },
  { name: "self-improvement improve yourself podcasts", utterance: "improve yourself to handle podcasts", kind: "command", expected: "none" },
  { name: "self-improvement teach yourself PDFs", utterance: "teach yourself to summarize PDFs", kind: "command", expected: "none" },
  { name: "self-improvement upgrade hivematrix emails", utterance: "upgrade hivematrix to send better emails", kind: "command", expected: "none" },
  { name: "self-improvement improve hive matrix calendar", utterance: "improve hive matrix's calendar support", kind: "command", expected: "none" },
  {
    name: "approval context",
    utterance: "approve it",
    kind: "command",
    expected: "command:approve",
    prime: async (deps) => { await commandTurnOverride("anything to approve", deps.command); },
  },
  { name: "deny second approval", utterance: "deny second", kind: "command", expected: "command:deny" },
  { name: "generic handoff", utterance: "compare lightweight CRMs for a solo founder", kind: "handoff", expected: "handoff:task" },
  { name: "fundraising plan handoff", utterance: "help me plan next quarter fundraising", kind: "handoff", expected: "handoff:task" },
  { name: "personal weekly reset handoff", utterance: "set up a weekly reset routine for home and work", kind: "handoff", expected: "handoff:task" },
  { name: "solo founder strategy handoff", utterance: "think through pricing for my solo founder product", kind: "handoff", expected: "handoff:task" },
  { name: "travel planning handoff", utterance: "plan a family weekend trip near Cincinnati", kind: "handoff", expected: "handoff:task" },
  { name: "content calendar handoff", utterance: "build a content calendar for the next month", kind: "handoff", expected: "handoff:task" },
  { name: "finance cleanup handoff", utterance: "organize my personal finance cleanup tasks", kind: "handoff", expected: "handoff:task" },
  { name: "hiring scorecard handoff", utterance: "draft a hiring scorecard for a part time assistant", kind: "handoff", expected: "handoff:task" },
];

export async function runVoiceLogicScenarios(optionsOrNow: VoiceLogicScenarioOptions | (() => string) = {}): Promise<VoiceLogicScenarioRun> {
  const options: VoiceLogicScenarioOptions = typeof optionsOrNow === "function" ? { now: optionsOrNow } : optionsOrNow;
  const now = options.now ?? (() => new Date().toISOString());
  const results: VoiceLogicScenarioResult[] = [];

  for (const scenario of scenarios) {
    const sideEffects: string[] = [];
    const deps = buildDeps(sideEffects, scenario, options);
    if (scenario.prime) await scenario.prime(deps);
    const result = await runScenario(scenario, deps, now);
    results.push({ ...result, sideEffects });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return { ok: failed === 0, passed, failed, scenarios: results, ranAt: now() };
}

function buildDeps(sideEffects: string[], scenario: Scenario, options: VoiceLogicScenarioOptions): ScenarioDeps {
  const synthesize = async () => "";
  const weatherCache = new Map<string, Promise<WeatherResult>>();
  const createTask = async (payload: Record<string, unknown>) => {
    const id = `sim-task-${sideEffects.length + 1}`;
    sideEffects.push(`simulated task:create ${String(payload.title ?? "untitled")}`);
    return { _id: id, title: String(payload.title ?? "untitled") };
  };
  const fetchWeather = async (location: string, when: WeatherWhen): Promise<WeatherResult> => {
    if (options.fetchWeather) return options.fetchWeather(location, when);
    if (options.liveWeather) {
      const key = `${location}|${when}`;
      if (!weatherCache.has(key)) weatherCache.set(key, getWeather(location, when));
      return weatherCache.get(key)!;
    }
    return {
      ok: true,
      report: { location, when, tempNow: 61, high: 68, low: 54, conditions: "Overcast", precipChance: 60, units: "fahrenheit" },
    };
  };

  return {
    sideEffects,
    skill: {
      synthesize,
      listSkills: async () => [skillIndex],
      readSkill: async () => skillBody,
      createInstructionTask: async (payload) => ({ _id: (await createTask(payload))._id }),
    },
    command: {
      sessionId: `voice-logic-diagnostic-${slug(scenario.name)}`,
      synthesize,
      getBoardCounts: () => ({ backlog: 4, in_progress: 2, review: 1, failed: 1, done: 9 }),
      buildApprovalQueue: async () => approvals,
      resolveApproval: async (taskId, timestamp, decision) => {
        sideEffects.push(`simulated approval:${decision} ${taskId}/${timestamp}`);
      },
      listDirectives: async () => [
        { _id: "directive-1", goal: "Release watcher", status: "active" },
        { _id: "directive-2", goal: "Inbox sweep", status: "sleeping" },
        { _id: "directive-3", goal: "Personal operations", status: "active" },
      ],
      updateDirective: async (id, fields) => {
        sideEffects.push(`simulated directive:update ${id} ${String(fields.status ?? "")}`);
      },
      listFailedTasks: async () => [{ _id: "failed-1", title: "Broken build" }],
      retryTask: async (id) => { sideEffects.push(`simulated task:retry ${id}`); },
      updateTaskModel: async (id, model) => {
        sideEffects.push(`simulated task:model ${id} ${model}`);
        return { title: `Task ${id}` };
      },
      getUsage: async () => ({ totalCost: 1.25, todayCost: 0.5, taskCount: 4, todayTaskCount: 2 }),
      getMetrics: async () => ({
        tasksByStatus: { backlog: 4, failed: 1 },
        directivesByStatus: { active: 2 },
        runs: { failed: 1, done: 12, total: 20 },
      }),
      getBrowserReadiness: () => ({
        needsAttention: 1,
        byColor: { green: 2, yellow: 0, orange: 0, red: 1, gray: 0 },
        staleCount: 0,
        topSites: [{ name: "Apple Developer", color: "red", status: "needs_login", siteId: "apple-developer", traceRunId: "trace-1" }],
      }),
      getWorkflowInbox: () => ({ needsReview: 1, ready: 2, blocked: 0, attention: 1 }),
      getLocation: () => options.location ?? "Kings Mills, OH",
      fetchWeather,
      createTask,
      createReminder: async ({ name, due }) => {
        sideEffects.push(`simulated reminder:create ${name}${due ? ` @ ${due}` : ""}`);
        return `Reminder set: "${name}"${due ? ` for ${due}` : " (no due time)"}.`;
      },
    },
  };
}

async function runScenario(scenario: Scenario, deps: ScenarioDeps, now: () => string): Promise<Omit<VoiceLogicScenarioResult, "sideEffects">> {
  let actual = "none";
  let reply = "";
  let audioBase64 = "";

  if (scenario.kind === "skill") {
    const out = await skillTurnOverride(scenario.utterance, deps.skill);
    if (out) {
      actual = `skill:${out.skill.action ?? "list"}`;
      reply = out.reply;
      audioBase64 = out.audioBase64;
    }
  } else if (scenario.kind === "command") {
    const out = await commandTurnOverride(scenario.utterance, deps.command);
    if (out) {
      actual = `command:${out.command.kind}`;
      reply = out.reply;
      audioBase64 = out.audioBase64;
    }
  } else {
    const session: VoiceSession = {
      sessionId: `diagnostic-${slug(scenario.name)}`,
      surface: "mac",
      startedAt: now(),
      turns: [{ role: "user", text: scenario.utterance }],
    };
    const out = routeVoiceSession(session);
    actual = `handoff:${out.kind}`;
    reply = out.kind === "none" ? out.reason : out.kind === "task" ? out.title : String(out.task.title);
  }

  const audioBytes = audioBase64 ? Buffer.from(audioBase64, "base64").byteLength : 0;
  return {
    name: scenario.name,
    utterance: scenario.utterance,
    expected: scenario.expected,
    actual,
    passed: actual === scenario.expected && audioBytes === 0,
    reply,
    audioBytes,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scenario";
}
