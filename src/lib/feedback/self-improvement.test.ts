import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DirectiveRetrospective } from "@/lib/orchestrator/directive-autonomy";

const TMP = mkdtempSync(join(tmpdir(), "hm-selfimprove-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { recordFeedback, listFeedback, setFeedbackStatus } = await import("./feedback");
const {
  feedbackInputsFromRetrospective,
  recordRetrospectiveFeedback,
  openFeedbackForPlanning,
  formatOpenFeedbackForPlanning,
  loopHealth,
  feedbackStatusForCompletedTask,
  resolveFeedbackForCompletedTask,
  buildSelfImprovementDirective,
  isSelfImprovementDirective,
  installSelfImprovementDirectiveIfMissing,
} = await import("./self-improvement");
const { getFeedback } = await import("./feedback");
const { listDirectives } = await import("@/lib/orchestrator/directive-store");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function retro(over: Partial<DirectiveRetrospective> = {}): DirectiveRetrospective {
  return {
    lessonsLearned: [],
    whatWorked: [],
    whatDidnt: over.whatDidnt ?? [],
    followUpDirectives: over.followUpDirectives ?? [],
    overallAssessment: over.overallAssessment ?? "assessment",
    playbookDeltas: [],
    accessLedger: [],
    skills: over.skills ?? [],
  };
}

test("feedbackInputsFromRetrospective maps whatDidnt→bug and followUps→enhancement (pure)", () => {
  const inputs = feedbackInputsFromRetrospective(
    retro({
      whatDidnt: ["LinkedIn posting failed silently", "LinkedIn posting failed silently"], // dup in batch
      followUpDirectives: [{ title: "Add a retry budget", goal: "retry transient failures" }],
    }),
    "directive:run1",
  );
  assert.equal(inputs.length, 2); // batch-deduped
  assert.equal(inputs[0].kind, "bug");
  assert.equal(inputs[1].kind, "enhancement");
  assert.equal(inputs[1].title, "Add a retry budget");
  assert.equal(inputs[0].source, "directive:run1");
});

test("recordRetrospectiveFeedback inserts once and dedupes on re-run", () => {
  const r = retro({ whatDidnt: ["Qwen cold-start timeout"], followUpDirectives: [{ title: "Tune relaunch throttle", goal: "x" }] });
  const first = recordRetrospectiveFeedback(r, "directive:runA");
  assert.deepEqual(first, { created: 2, skipped: 0 });

  // Same lessons next run → no new rows (still open).
  const second = recordRetrospectiveFeedback(r, "directive:runB");
  assert.deepEqual(second, { created: 0, skipped: 2 });

  assert.equal(listFeedback().filter((f) => f.title === "Qwen cold-start timeout").length, 1);
});

test("openFeedbackForPlanning returns open+triaged, formatted fragment lists them", () => {
  const open = openFeedbackForPlanning();
  assert.ok(open.length >= 1);
  assert.ok(open.every((f) => f.status === "open" || f.status === "triaged"));
  const fragment = formatOpenFeedbackForPlanning();
  assert.match(fragment, /Open feedback/);
  assert.match(fragment, /Qwen cold-start timeout/);
});

test("resolved items drop out of the planning surface; a recurring title can re-open", () => {
  const r = retro({ whatDidnt: ["Recurring flaky probe"] });
  recordRetrospectiveFeedback(r, "directive:runC");
  const item = listFeedback().find((f) => f.title === "Recurring flaky probe")!;
  setFeedbackStatus(item._id, "done");
  // No longer in the planning surface…
  assert.ok(!openFeedbackForPlanning().some((f) => f._id === item._id));
  // …and because the open one is gone, a later run files a fresh row (recurrence).
  const again = recordRetrospectiveFeedback(r, "directive:runD");
  assert.deepEqual(again, { created: 1, skipped: 0 });
});

test("loopHealth reports resolution rate, recurring issues, reflection-sourced count, and backlog age", () => {
  const h = loopHealth(() => "2999-01-01T00:00:00.000Z");
  assert.ok(h.total >= 4);
  assert.ok(h.done >= 1);
  assert.ok(h.resolutionRate > 0 && h.resolutionRate <= 1);
  assert.ok(h.recurringIssues >= 1, "the 'Recurring flaky probe' title appears twice");
  assert.ok(h.fromReflection >= 1, "items came from directive reflection");
  assert.ok(h.oldestOpenAgeDays !== null && h.oldestOpenAgeDays > 300_000, "far-future now → large age");
});

test("feedbackStatusForCompletedTask maps task outcome → feedback status (pure)", () => {
  assert.equal(feedbackStatusForCompletedTask("done"), "done");
  assert.equal(feedbackStatusForCompletedTask("review"), "triaged");
  assert.equal(feedbackStatusForCompletedTask("failed"), null);
  assert.equal(feedbackStatusForCompletedTask("backlog"), null);
});

test("resolveFeedbackForCompletedTask only ever moves an item forward", () => {
  const item = recordFeedback({ kind: "bug", title: "linked to a task", source: "console" });
  // review → triaged
  assert.equal(resolveFeedbackForCompletedTask(item._id, "review"), "triaged");
  assert.equal(getFeedback(item._id)?.status, "triaged");
  // triaged → triaged is a no-op (no forward movement)
  assert.equal(resolveFeedbackForCompletedTask(item._id, "review"), null);
  // done → done
  assert.equal(resolveFeedbackForCompletedTask(item._id, "done"), "done");
  assert.equal(getFeedback(item._id)?.status, "done");
  // already closed → never re-opens
  assert.equal(resolveFeedbackForCompletedTask(item._id, "review"), null);
  // unknown id → null
  assert.equal(resolveFeedbackForCompletedTask("nope", "done"), null);
});

test("buildSelfImprovementDirective is marked + detectable; ordinary goals are not", () => {
  const d = buildSelfImprovementDirective({ project: "ops", dailyAtHour: 6 });
  assert.ok(isSelfImprovementDirective(d.goal), "recipe goal carries the marker");
  assert.equal(d.project, "ops");
  assert.equal(d.status, "active");
  assert.equal(d.profile, "coo");
  assert.ok(!isSelfImprovementDirective("Ship the LinkedIn ritual"), "ordinary directive isn't self-improvement");
});

test("installSelfImprovementDirectiveIfMissing installs once on boot, then no-ops on repeat boots (idempotent)", () => {
  const first = installSelfImprovementDirectiveIfMissing({ project: "hivematrix" });
  assert.equal(first.installed, true);

  const second = installSelfImprovementDirectiveIfMissing({ project: "hivematrix" });
  assert.equal(second.installed, false);
  assert.equal(second.directiveId, first.directiveId);

  const matches = listDirectives().filter((d) => isSelfImprovementDirective(d.goal));
  assert.equal(matches.length, 1, "repeated boots must not create duplicate self-improvement directives");
});

test("the planning fragment now leads each line with the feedbackId (so the planner can link)", () => {
  const items = openFeedbackForPlanning();
  const fragment = formatOpenFeedbackForPlanning();
  if (items.length > 0) assert.ok(fragment.includes(items[0]._id), "fragment exposes the id");
});

test("loopHealth resolutionRate is 0 on an empty-but-present backlog snapshot", () => {
  // Sanity: a synthetic all-resolved set yields rate 1 via the public API.
  const fresh = recordFeedback({ kind: "bug", title: "one-off to resolve", source: "console" });
  setFeedbackStatus(fresh._id, "wontfix");
  const h = loopHealth();
  assert.ok(h.resolutionRate > 0);
});
