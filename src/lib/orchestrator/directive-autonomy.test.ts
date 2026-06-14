import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  extractDirectiveJson,
  parseDirectivePlanOutput,
  parseDirectiveReviewOutput,
  parseDirectiveRetrospectiveOutput,
  parseDirectiveCheckpointPolicy,
  normalizeDirectivePlan,
  writeDirectiveRetrospectiveLearning,
} from "./directive-autonomy";

test("parseDirectiveCheckpointPolicy reads terse, nested, default, and bad shapes", () => {
  assert.equal(parseDirectiveCheckpointPolicy(JSON.stringify({ checkpoint: "plan" })).level, "plan");
  assert.equal(parseDirectiveCheckpointPolicy(JSON.stringify({ checkpoint: "full" })).level, "full");
  assert.equal(parseDirectiveCheckpointPolicy(JSON.stringify({ checkpoint: { level: "plan" } })).level, "plan");
  // default / empty / inert config → none
  assert.equal(parseDirectiveCheckpointPolicy(JSON.stringify({})).level, "none");
  assert.equal(parseDirectiveCheckpointPolicy("{}").level, "none");
  assert.equal(parseDirectiveCheckpointPolicy(null).level, "none");
  assert.equal(parseDirectiveCheckpointPolicy(undefined).level, "none");
  // unknown / malformed → none (fails open to "no gate")
  assert.equal(parseDirectiveCheckpointPolicy(JSON.stringify({ checkpoint: "sometimes" })).level, "none");
  assert.equal(parseDirectiveCheckpointPolicy("not json").level, "none");
});

const CRITERIA = [
  { _id: "crit_a", description: "Alpha criterion" },
  { _id: "crit_b", description: "Beta criterion" },
];

test("extractDirectiveJson extracts fenced JSON and reports invalid JSON", () => {
  const ok = extractDirectiveJson<{ value: number }>('reason\n```json\n{"value":42}\n```');
  assert.deepEqual(ok.parsed, { value: 42 });
  assert.equal(ok.error, null);

  const bad = extractDirectiveJson("```json\n{ nope\n```");
  assert.equal(bad.parsed, null);
  assert.match(bad.error ?? "", /JSON parse error/);
});

test("parseDirectivePlanOutput normalizes tasks with dependencies and criterion refs", () => {
  const parsed = parseDirectivePlanOutput(`Plan:\n\`\`\`json
{
  "tasks": [
    {
      "title": "Gather source facts",
      "description": "Read the project docs.",
      "agentType": "researcher",
      "dependsOn": [],
      "criterionRefs": ["crit_a"],
      "goalIndex": 0,
      "feedbackId": "fb_123"
    },
    {
      "title": "Write implementation",
      "description": "Patch the code.",
      "agentType": "developer",
      "dependsOn": [0, 99],
      "criterionRefs": ["Beta criterion"],
      "goalIndex": 1
    }
  ]
}
\`\`\``, CRITERIA);

  assert.equal(parsed.error, null);
  assert.equal(parsed.plan?.tasks.length, 2);
  assert.deepEqual(parsed.plan?.tasks[1].dependsOn, [0], "invalid dependency refs are dropped");
  assert.deepEqual(parsed.plan?.tasks[0].criterionIds, ["crit_a"]);
  assert.deepEqual(parsed.plan?.tasks[1].criterionIds, ["crit_b"]);
  assert.equal(parsed.plan?.tasks[0].feedbackId, "fb_123", "feedbackId link is parsed");
  assert.equal(parsed.plan?.tasks[1].feedbackId, null, "absent feedbackId is null");
});

test("parseDirectiveReviewOutput normalizes review status and corrective tasks", () => {
  const parsed = parseDirectiveReviewOutput(`\`\`\`json
{
  "status": "partial",
  "findings": [{ "task": "A", "assessment": "pass", "notes": "done" }],
  "gaps": ["missing B"],
  "correctiveTasks": [
    { "title": "Fix B", "description": "Do B", "agentType": "developer", "criterionRefs": ["crit_b"] }
  ],
  "summary": "Mostly done."
}
\`\`\``, CRITERIA);

  assert.equal(parsed.error, null);
  assert.equal(parsed.review?.status, "partial");
  assert.equal(parsed.review?.correctiveTasks.length, 1);
  assert.deepEqual(parsed.review?.correctiveTasks[0].criterionIds, ["crit_b"]);
});

test("parseDirectiveRetrospectiveOutput returns playbook deltas and access ledger entries", () => {
  const parsed = parseDirectiveRetrospectiveOutput(`\`\`\`json
{
  "lessonsLearned": ["Keep tasks tiny"],
  "whatWorked": ["TDD"],
  "whatDidnt": ["Missing credentials"],
  "followUpDirectives": [{ "title": "Harden", "goal": "Make it sturdier" }],
  "overallAssessment": "Useful.",
  "playbookDeltas": [
    { "scope": "role:coo", "rule": "Check credentials first", "reason": "Avoid blocked tasks", "confidence": "high" }
  ],
  "accessLedger": [
    { "system": "Stripe", "status": "test-mode", "notes": "No live key" }
  ],
  "skills": [
    { "name": "credential-preflight", "description": "verify creds before planning", "tags": ["ops"], "body": "1. list required systems\\n2. check each\\n3. block if missing" },
    { "name": "bad-skill-no-body" }
  ]
}
\`\`\``);

  assert.equal(parsed.error, null);
  assert.equal(parsed.retrospective?.playbookDeltas[0].scope, "role:coo");
  assert.equal(parsed.retrospective?.accessLedger[0].system, "Stripe");
  assert.equal(parsed.retrospective?.followUpDirectives[0].goal, "Make it sturdier");
  assert.equal(parsed.retrospective?.skills.length, 1, "skill without a body is dropped");
  assert.equal(parsed.retrospective?.skills[0].name, "credential-preflight");
  assert.match(parsed.retrospective!.skills[0].body, /block if missing/);
});

test("normalizeDirectivePlan rejects missing task arrays", () => {
  const result = normalizeDirectivePlan({ nope: [] }, CRITERIA);
  assert.equal(result.plan, null);
  assert.match(result.error ?? "", /tasks/);
});

test("writeDirectiveRetrospectiveLearning appends playbook deltas and upserts access ledger", async () => {
  const brainRoot = mkdtempSync(join(tmpdir(), "hm-directive-brain-"));
  try {
    const parsed = parseDirectiveRetrospectiveOutput(`\`\`\`json
{
  "overallAssessment": "Useful.",
  "playbookDeltas": [
    { "scope": "role:coo", "rule": "Check credentials first", "reason": "Avoid blocked tasks", "confidence": "high" },
    { "scope": "project:hivematrix", "rule": "Keep directive tasks tiny" }
  ],
  "accessLedger": [
    { "system": "Stripe", "status": "test-mode", "notes": "No live key" }
  ]
}
\`\`\``);
    assert.ok(parsed.retrospective);

    const result = await writeDirectiveRetrospectiveLearning(parsed.retrospective!, {
      brainRootDir: brainRoot,
      project: "hivematrix",
      runId: "run_123",
      directiveGoal: "Ship autonomy",
      dateStr: "2026-06-12",
    });

    assert.equal(result.roleFiles.length, 1);
    assert.equal(result.projectFiles.length, 1);
    assert.ok(result.accessLedgerFile);
    assert.match(readFileSync(join(brainRoot, "hive", "playbooks", "roles", "coo.md"), "utf-8"), /Check credentials first/);
    assert.match(readFileSync(join(brainRoot, "hive", "playbooks", "projects", "hivematrix.md"), "utf-8"), /Keep directive tasks tiny/);
    assert.match(readFileSync(join(brainRoot, "hive", "playbooks", "projects", "hivematrix-access.md"), "utf-8"), /Stripe/);
  } finally {
    rmSync(brainRoot, { recursive: true, force: true });
  }
});
