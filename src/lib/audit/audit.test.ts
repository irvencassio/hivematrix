import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-audit-"));
const origHome = process.env.HOME;
process.env.HOME = TMP;

const { recordAudit, readAudit } = await import("./audit");
const { recordTaskAudit } = await import("./task-audit");

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

test("recordAudit appends and readAudit returns newest-first, filtered, no secret leak", () => {
  recordAudit({ event: "task_completed", ts: "2026-06-14T01:00:00.000Z", taskId: "t1", status: "review", prompt: "email bob hi" });
  recordAudit({ event: "task_failed", ts: "2026-06-14T02:00:00.000Z", taskId: "t2", status: "failed", summary: "boom" });

  const all = readAudit();
  assert.equal(all[0].taskId, "t2", "newest first");
  assert.equal(readAudit({ status: "failed" }).length, 1);
  assert.equal(readAudit({ taskId: "t1" })[0].prompt, "email bob hi");
  assert.equal(readAudit({ event: "task_completed" }).length, 1);
});

test("recordAudit persists actor + target for lane identity/target parity (Canopy-style)", () => {
  recordAudit({ event: "browser:read", ts: "2026-06-14T02:30:00.000Z", actor: "voice", target: "https://example.com", prompt: "who won the game", status: "ok" });
  recordAudit({ event: "browser:job_created", ts: "2026-06-14T02:31:00.000Z", actor: "cli", target: "https://portal.example/login", taskId: "bl1", status: "created" });
  const read = readAudit({ event: "browser:read" })[0];
  assert.equal(read.actor, "voice", "actor identity is recorded");
  assert.equal(read.target, "https://example.com", "target is recorded");
  const job = readAudit({ event: "browser:job_created" })[0];
  assert.equal(job.actor, "cli");
  assert.equal(job.taskId, "bl1");
});

test("recordAudit clamps long fields", () => {
  recordAudit({ event: "task_completed", ts: "2026-06-14T03:00:00.000Z", taskId: "big", prompt: "x".repeat(9000) });
  const e = readAudit({ taskId: "big" })[0];
  assert.ok(e.prompt!.length < 5000 && e.prompt!.endsWith("…[truncated]"));
});

test("recordTaskAudit records the diff stat via an injected capturer", async () => {
  await recordTaskAudit(
    { taskId: "code1", status: "review", prompt: "refactor", projectPath: "/repo", model: "claude-sonnet-4-6" },
    { captureDiff: async () => " src/a.ts | 4 ++--\n 1 file changed" },
  );
  const e = readAudit({ taskId: "code1" })[0];
  assert.equal(e.status, "review");
  assert.match(e.diffStat!, /1 file changed/);
});

test("recordTaskAudit with no projectPath omits the diff", async () => {
  await recordTaskAudit({ taskId: "nodiff", status: "done", prompt: "answer a question" });
  const e = readAudit({ taskId: "nodiff" })[0];
  assert.equal(e.diffStat, undefined);
});
