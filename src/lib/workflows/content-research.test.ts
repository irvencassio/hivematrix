import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-content-research-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { getWorkflowRun } = await import("./runs");
const { listWorkflowActions, getWorkflowAction } = await import("./actions");
const { buildResearchBriefMarkdown, prepareContentResearchBrief } = await import("./content-research");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events;"); });

const fakeSearch = async () => ({
  root: "/brain", query: "x", terms: ["x"], filesScanned: 2, truncated: false,
  hits: [
    { path: "projects/ai-video.md", score: 3, snippet: "Local notes on AI video tooling and HeyGen." },
    { path: "ideas/shorts.md", score: 2, snippet: "Shorts perform best under 60 seconds." },
  ],
});

test("buildResearchBriefMarkdown is deterministic and includes the required sections", () => {
  const md = buildResearchBriefMarkdown(
    { topic: "AI video tools", audience: "solo founders", objective: "plan a launch video" },
    { hits: [{ path: "p.md", snippet: "a local note" }], providedSources: ["https://example.com/a"] },
  );
  assert.match(md, /# Research brief: AI video tools/);
  assert.match(md, /solo founders/);
  assert.match(md, /plan a launch video/);
  assert.match(md, /## Sources considered/);
  assert.match(md, /p\.md/);
  assert.match(md, /example\.com\/a/);
  assert.match(md, /## Open questions/);
  assert.match(md, /## Suggested next action/);
  // Deterministic: same inputs → identical output.
  const md2 = buildResearchBriefMarkdown(
    { topic: "AI video tools", audience: "solo founders", objective: "plan a launch video" },
    { hits: [{ path: "p.md", snippet: "a local note" }], providedSources: ["https://example.com/a"] },
  );
  assert.equal(md, md2);
});

test("the markdown scrubs obvious secrets from local snippets", () => {
  const md = buildResearchBriefMarkdown(
    { topic: "T" },
    { hits: [{ path: "leak.md", snippet: "api_key=SHOULD_NOT_APPEAR token=NOPE" }], providedSources: [] },
  );
  assert.doesNotMatch(md, /SHOULD_NOT_APPEAR|NOPE/);
  assert.match(md, /\[redacted\]/);
});

test("prepareContentResearchBrief creates a run with a briefMarkdown artifact (no live web)", async () => {
  const result = await prepareContentResearchBrief(
    { topic: "AI video tools", audience: "solo founders" },
    { search: fakeSearch },
  );
  assert.equal(result.workflow.id, "content.research_brief");
  assert.ok(result.runId);
  assert.match(result.markdown, /# Research brief: AI video tools/);
  assert.ok(result.sources.length >= 1);

  const run = getWorkflowRun(result.runId);
  assert.ok(run);
  assert.equal(run.workflowId, "content.research_brief");
  assert.equal(run.status, "needs_review");
  assert.match(String(run.artifacts.briefMarkdown), /Research brief/);
  // No external side effect: nothing posted/published; no secrets.
  assert.doesNotMatch(JSON.stringify(run), /password|cookie|secret|credentialRef|\btoken\b/i);
});

test("prepareContentResearchBrief requires a topic", async () => {
  await assert.rejects(() => prepareContentResearchBrief({ topic: "  " }, { search: fakeSearch }), /topic/i);
});

test("preparing a brief proposes the SCRIPT workflow (not HeyGen) and does NOT auto-execute it", async () => {
  const result = await prepareContentResearchBrief({ topic: "AI video tools" }, { search: fakeSearch });
  // The brief now bridges to the script-development step.
  assert.ok(result.proposedAction, "result should include the proposed action");
  assert.equal(result.proposedAction.targetWorkflowId, "content.video_script_from_brief");

  const actions = listWorkflowActions({ sourceRunId: result.runId });
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.equal(action.status, "proposed");           // not executed
  assert.equal(action.resultRunId, null);             // nothing run yet
  assert.match(action.title, /AI video tools/);
  // It carries the brief linkage so the script workflow can load it.
  assert.equal(action.suggestedInputs.sourceRunId, result.runId);

  // Nothing downstream was created during brief prep.
  const scriptRuns = getDb().prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE workflowId = 'content.video_script_from_brief'").get() as { n: number };
  assert.equal(scriptRuns.n, 0);

  assert.doesNotMatch(JSON.stringify(getWorkflowAction(action.id)), /password|cookie|secret|credentialRef|\btoken\b/i);
});

test("chain: review gate enforced — approve brief, prepare script, revise + approve, then HeyGen prepares with the revised script and no Browser Lane task", async () => {
  const { executeWorkflowAction } = await import("./actions");
  const { reviewWorkflowRun, reviseWorkflowRunArtifact, getWorkflowRunRecord } = await import("./runs");
  const brief = await prepareContentResearchBrief({ topic: "AI video tools", audience: "solo founders" }, { search: fakeSearch });
  assert.ok(brief.proposedAction);

  // The brief run is needs_review → executing its action is blocked until approved.
  const blocked = await executeWorkflowAction(brief.proposedAction.id, {});
  assert.equal(blocked.status, "review_required");

  // Approve the brief → the script action unlocks.
  reviewWorkflowRun(brief.runId, "approve", {});
  const scriptExec = await executeWorkflowAction(brief.proposedAction.id, {});
  assert.equal(scriptExec.ok, true);
  assert.ok(scriptExec.resultRunId);
  const scriptRun = getWorkflowRun(scriptExec.resultRunId);
  assert.equal(scriptRun?.workflowId, "content.video_script_from_brief");
  assert.equal(scriptRun?.status, "needs_review");

  // The script's HeyGen action is blocked until the script is approved.
  const heygenAction = listWorkflowActions({ sourceRunId: scriptExec.resultRunId })[0];
  assert.equal(heygenAction.targetWorkflowId, "heygen.portal_video_from_script");
  const stillBlocked = await executeWorkflowAction(heygenAction.id, {});
  assert.equal(stillBlocked.status, "review_required");

  // Revise the script, then approve. Execution must use the REVISED script.
  reviseWorkflowRunArtifact(scriptExec.resultRunId, "scriptText", "REVISED narration for the final cut.");
  reviewWorkflowRun(scriptExec.resultRunId, "approve", {});
  let dispatchedScript = "";
  const heygenExec = await executeWorkflowAction(heygenAction.id, {}, {
    prepare: async (_wid, inputs) => { dispatchedScript = String(inputs.script); return { ok: true, status: "prepared", workflow: null }; },
  });
  assert.equal(heygenExec.ok, true);
  assert.match(dispatchedScript, /REVISED narration/);

  // No Browser Lane task was created.
  const tasks = getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'browser-lane'").get() as { n: number };
  assert.equal(tasks.n, 0);
  void getWorkflowRunRecord;
});
