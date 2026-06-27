import { commandTurnOverride, type CommandTurnDeps } from "./command-turn";
import { routeVoiceSession, type VoiceSession } from "./session";
import { skillTurnOverride } from "./skill-turn";
import type { Skill, SkillIndexEntry } from "@/lib/skills/contracts";
import type { ApprovalQueueItem } from "@/lib/approvals/queue";
import { videoVoiceOverride } from "@/lib/video/voice-turn";

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

type ScenarioKind = "skill" | "video" | "command" | "handoff";

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
  video: Parameters<typeof videoVoiceOverride>[1];
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
};

const scenarios: Scenario[] = [
  { name: "skill listing", utterance: "what skills do I have", kind: "skill", expected: "skill:list" },
  { name: "video review read", utterance: "read me the video script", kind: "video", expected: "video:video-read" },
  { name: "briefing", utterance: "good morning", kind: "command", expected: "command:briefing" },
  { name: "weather", utterance: "what's the weather today", kind: "command", expected: "command:weather" },
  { name: "browser lane task", utterance: "use browser lane to search Tesla Model S price", kind: "command", expected: "command:browserLaneTask" },
  { name: "mail delete review", utterance: "delete the latest email from Stripe", kind: "command", expected: "command:mailDeleteTask" },
  {
    name: "approval context",
    utterance: "approve it",
    kind: "command",
    expected: "command:approve",
    prime: async (deps) => { await commandTurnOverride("anything to approve", deps.command); },
  },
  { name: "generic handoff", utterance: "remind me to call Dave tomorrow", kind: "handoff", expected: "handoff:task" },
];

export async function runVoiceLogicScenarios(now: () => string = () => new Date().toISOString()): Promise<VoiceLogicScenarioRun> {
  const results: VoiceLogicScenarioResult[] = [];

  for (const scenario of scenarios) {
    const sideEffects: string[] = [];
    const deps = buildDeps(sideEffects);
    if (scenario.prime) await scenario.prime(deps);
    const result = await runScenario(scenario, deps, now);
    results.push({ ...result, sideEffects });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return { ok: failed === 0, passed, failed, scenarios: results, ranAt: now() };
}

function buildDeps(sideEffects: string[]): ScenarioDeps {
  const synthesize = async () => "";
  const createTask = async (payload: Record<string, unknown>) => {
    const id = `sim-task-${sideEffects.length + 1}`;
    sideEffects.push(`simulated task:create ${String(payload.title ?? "untitled")}`);
    return { _id: id, title: String(payload.title ?? "untitled") };
  };

  return {
    sideEffects,
    skill: {
      synthesize,
      listSkills: async () => [skillIndex],
      readSkill: async () => skillBody,
      createInstructionTask: async (payload) => ({ _id: (await createTask(payload))._id }),
    },
    video: {
      synthesize,
      latestDraft: () => null,
    },
    command: {
      sessionId: "voice-logic-diagnostic",
      synthesize,
      buildApprovalQueue: async () => approvals,
      resolveApproval: async (taskId, timestamp, decision) => {
        sideEffects.push(`simulated approval:${decision} ${taskId}/${timestamp}`);
      },
      listDirectives: async () => [{ _id: "directive-1", goal: "Release watcher", status: "active" }],
      listFailedTasks: async () => [{ _id: "failed-1", title: "Broken build" }],
      getUsage: async () => ({ totalCost: 1.25, todayCost: 0.5, taskCount: 4, todayTaskCount: 2 }),
      getBrowserReadiness: () => ({
        needsAttention: 1,
        byColor: { green: 2, yellow: 0, orange: 0, red: 1, gray: 0 },
        staleCount: 0,
        topSites: [{ name: "Apple Developer", color: "red", status: "needs_login", siteId: "apple-developer", traceRunId: "trace-1" }],
      }),
      getWorkflowInbox: () => ({ needsReview: 1, ready: 2, blocked: 0, attention: 1 }),
      getLocation: () => "San Francisco, CA",
      fetchWeather: async (location, when) => ({
        ok: true,
        report: { location, when, tempNow: 61, high: 68, low: 54, conditions: "Overcast", precipChance: 60, units: "fahrenheit" },
      }),
      createTask,
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
  } else if (scenario.kind === "video") {
    const out = await videoVoiceOverride(scenario.utterance, deps.video);
    if (out) {
      actual = `video:${out.command.kind}`;
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
