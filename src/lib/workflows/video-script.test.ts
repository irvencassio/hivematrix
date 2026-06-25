import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-video-script-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { createWorkflowRun, getWorkflowRun, linkWorkflowRunArtifact } = await import("./runs");
const { listWorkflowActions, getWorkflowAction } = await import("./actions");
const { buildVideoScriptMarkdown, buildVideoScriptText, prepareVideoScriptFromBrief } = await import("./video-script");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events; DELETE FROM workflow_actions;"); });

const INPUT = { topic: "AI video tools", audience: "solo founders", objective: "show why it saves time", briefMarkdown: "## Key points\n- Local AI is fast" };

test("buildVideoScriptMarkdown is deterministic, marked DRAFT, and has every section", () => {
  const md = buildVideoScriptMarkdown(INPUT, { briefExcerpt: "local AI is fast" });
  assert.match(md, /DRAFT/);
  assert.match(md, /AI video tools/);
  assert.match(md, /Hook/i);
  assert.match(md, /## Beats|Beat outline/i);
  assert.match(md, /## Script/);
  assert.match(md, /CTA/i);
  assert.match(md, /Assumptions|open questions/i);
  assert.equal(md, buildVideoScriptMarkdown(INPUT, { briefExcerpt: "local AI is fast" }));
});

test("the narration text and markdown scrub obvious secrets from the brief", () => {
  const ctx = { briefExcerpt: "token=SHOULD_NOT_APPEAR api_key=NOPE" };
  assert.doesNotMatch(buildVideoScriptText({ topic: "T" }, ctx), /SHOULD_NOT_APPEAR|NOPE/);
  assert.doesNotMatch(buildVideoScriptMarkdown({ topic: "T" }, ctx), /SHOULD_NOT_APPEAR|NOPE/);
});

test("prepareVideoScriptFromBrief creates a needs_review run with a script artifact and proposes HeyGen with a REAL script", async () => {
  const out = await prepareVideoScriptFromBrief(INPUT);
  assert.equal(out.workflow.id, "content.video_script_from_brief");
  assert.equal(out.isDraft, true);
  assert.ok(out.runId);
  assert.ok(out.script.length > 0);
  assert.match(out.markdown, /DRAFT/);

  const run = getWorkflowRun(out.runId);
  assert.equal(run?.status, "needs_review");
  assert.match(String(run?.artifacts.scriptMarkdown), /AI video tools/);
  assert.ok(run?.artifacts.scriptText);

  // Proposes HeyGen with real title + script (so the HeyGen action can prepare).
  const actions = listWorkflowActions({ sourceRunId: out.runId });
  assert.equal(actions.length, 1);
  const a = actions[0];
  assert.equal(a.targetWorkflowId, "heygen.portal_video_from_script");
  assert.equal(a.status, "proposed");
  assert.ok(String(a.suggestedInputs.script).length > 0, "real script suggested");
  assert.ok(String(a.suggestedInputs.title).length > 0, "title suggested");
  // It maps fresh source artifacts (revised script) onto the HeyGen inputs.
  assert.equal(a.sourceArtifactMap.script, "scriptText");
  assert.equal(a.sourceArtifactMap.title, "title");
  // The proposal makes the approval requirement explicit.
  assert.match(a.reason, /approv/i);
  // No secrets anywhere.
  assert.doesNotMatch(JSON.stringify(getWorkflowAction(a.id)), /password|cookie|secret|credentialRef|\btoken\b/i);
});

test("prepareVideoScriptFromBrief loads the brief from a prior research run (sourceRunId)", async () => {
  const briefRun = createWorkflowRun({ workflowId: "content.research_brief", title: "brief" });
  linkWorkflowRunArtifact(briefRun.id, "briefMarkdown", "## Key points\n- Solo founders love speed");
  const out = await prepareVideoScriptFromBrief({ topic: "AI video tools", sourceRunId: briefRun.id });
  assert.ok(out.runId);
  assert.match(out.markdown, /AI video tools/);
});

test("prepareVideoScriptFromBrief errors when neither briefMarkdown nor sourceRunId is given", async () => {
  await assert.rejects(() => prepareVideoScriptFromBrief({ topic: "AI video tools" }), /brief|sourceRunId/i);
});
