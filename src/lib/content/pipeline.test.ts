import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate DB + HOME (artifacts dir + approvals dir) before importing.
const TMP = mkdtempSync(join(tmpdir(), "hm-content-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { getPendingApprovals } = await import("@/lib/orchestrator/approval");
const { buildRenditionPrompt } = await import("./channels");
const { runContentPipeline, generateRenditions, _setContentRendererForTests } = await import("./pipeline");

_resetDbForTests();
getDb();

test.after(() => {
  _setContentRendererForTests(null);
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test.afterEach(() => _setContentRendererForTests(null));

test("buildRenditionPrompt weaves brief fields and channel guidance", () => {
  const prompt = buildRenditionPrompt(
    { topic: "Launch week", audience: "solo founders", goal: "signups" },
    "linkedin_post",
  );
  assert.match(prompt, /LinkedIn post/);
  assert.match(prompt, /Topic: Launch week/);
  assert.match(prompt, /Audience: solo founders/);
  assert.match(prompt, /Goal: signups/);
});

test("runContentPipeline stages a rendition per channel and raises one approval", async () => {
  _setContentRendererForTests(async (channel) => ({ ok: true, text: `# ${channel}\nbody for ${channel}`, detail: "ok" }));

  const result = await runContentPipeline("task_content_1", { topic: "Launch week" }, undefined, "s1");

  assert.equal(result.renditions.length, 4);
  assert.ok(result.renditions.every((r) => r.ok), "all channels render");
  // Each rendition is staged as a real markdown file.
  for (const r of result.renditions) {
    assert.ok(r.path && existsSync(r.path), `${r.channel} file staged`);
    assert.match(readFileSync(r.path!, "utf-8"), new RegExp(`body for ${r.channel}`));
  }
  // Exactly one approve-by-text gate is raised for the whole brief.
  assert.equal(result.approvalRequested, true);
  const pending = getPendingApprovals().filter((p) => p.taskId === "task_content_1");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].timestamp, "checkpoint-content");
});

test("a failed rendition is reported but does not block the others", async () => {
  _setContentRendererForTests(async (channel) =>
    channel === "x_thread"
      ? { ok: false, text: "", detail: "backend not configured" }
      : { ok: true, text: `ok ${channel}`, detail: "ok" },
  );

  const renditions = await generateRenditions("task_content_2", { topic: "T" }, ["linkedin_post", "x_thread"], "s2");
  const byChannel = Object.fromEntries(renditions.map((r) => [r.channel, r]));
  assert.equal(byChannel.linkedin_post.ok, true);
  assert.equal(byChannel.x_thread.ok, false);
  assert.match(byChannel.x_thread.detail, /not configured/);
});
