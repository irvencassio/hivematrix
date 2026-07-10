import test from "node:test";
import assert from "node:assert/strict";
import { skillTurnOverride } from "./skill-turn";
import type { Skill, SkillIndexEntry } from "@/lib/skills/contracts";

function index(p: Partial<SkillIndexEntry>): SkillIndexEntry {
  return { name: "deploy-release", description: "ship a release", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction", roles: [], ...p };
}

function skill(p: Partial<Skill>): Skill {
  return {
    name: "deploy-release",
    description: "ship a release",
    tags: [],
    body: "Do the release: {{input}}",
    source: "test",
    trusted: true,
    kind: "instruction",
    interpreter: "bash",
    useCount: 0,
    revisions: 1,
    createdAt: "T",
    updatedAt: "T",
    lastUsedAt: "",
    compat: ["all"],
    scope: "personal",
    scanVerdict: "pass",
    roles: [],
    ...p,
  };
}

test("skillTurnOverride launches an instruction skill task for a use/run request", async () => {
  const created: Record<string, unknown>[] = [];
  const out = await skillTurnOverride("run the deploy release skill", {
    listSkills: async () => [index({})],
    readSkill: async () => skill({}),
    createInstructionTask: async (payload) => {
      created.push(payload);
      return { _id: "task_1" };
    },
    synthesize: async () => "",
  });

  assert.ok(out);
  assert.equal(out?.skill.action, "use");
  assert.equal(out?.skill.name, "deploy-release");
  assert.equal(out?.skill.taskId, "task_1");
  assert.match(out?.reply ?? "", /Started the deploy release skill as a task/);
  assert.equal(created.length, 1);
  assert.match(String(created[0].description), /Apply this skill/);
});

test("skillTurnOverride launches a trusted script skill run", async () => {
  const out = await skillTurnOverride("use deploy release skill", {
    listSkills: async () => [index({ kind: "script" })],
    readSkill: async () => skill({ kind: "script", body: "echo ok" }),
    runScriptSkill: () => ({ ok: true, run: { runId: "run_1", logPath: "/tmp/log", pid: null } }),
    synthesize: async () => "",
  });

  assert.ok(out);
  assert.equal(out?.skill.runId, "run_1");
  assert.match(out?.reply ?? "", /Started the deploy release script skill/);
});
