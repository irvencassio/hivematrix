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

// ── actorKind + richer filters (Canopy-parity History Panel — 2026-07-16) ────
//
// Not implemented yet — see
// docs/superpowers/specs/2026-07-16-browser-lane-canopy-parity-design.md.
// actorKind is additive on AuditEntry; ReadAuditOptions gains actorKind/target/
// eventPrefix/since/until.

test("recordAudit persists actorKind and readAudit's actorKind filter narrows to just that kind", () => {
  recordAudit({ event: "browser:read", ts: "2026-06-14T04:05:00.000Z", actor: "hive", actorKind: "agent" as never, target: "https://filter-check.example/agent", status: "ok" });
  recordAudit({ event: "browser:read", ts: "2026-06-14T04:06:00.000Z", actor: "operator", actorKind: "human" as never, target: "https://filter-check.example/human", status: "ok" });

  // Round trip: the field survives storage (JSONL is schema-less).
  const agentEntry = readAudit({ target: "filter-check.example/agent" })[0];
  assert.equal(agentEntry.actorKind, "agent");

  // Filtering: readAudit must not yet ignore actorKind — this needs new code.
  const humanEntries = readAudit({ actorKind: "human", target: "filter-check.example" } as never);
  assert.equal(humanEntries.length, 1);
  assert.equal(humanEntries[0].target, "https://filter-check.example/human");
});

test("readAudit target filter does a case-insensitive substring match", () => {
  recordAudit({ event: "browser:read", ts: "2026-06-14T04:10:00.000Z", actor: "hive", target: "https://www.linkedin.com/messaging/", status: "ok" });
  recordAudit({ event: "browser:read", ts: "2026-06-14T04:11:00.000Z", actor: "hive", target: "https://example.com/other", status: "ok" });

  const linkedinOnly = readAudit({ target: "linkedin" } as never);
  assert.equal(linkedinOnly.length, 1);
  assert.equal(linkedinOnly[0].target, "https://www.linkedin.com/messaging/");

  // Case-insensitive.
  const upperCase = readAudit({ target: "LINKEDIN" } as never);
  assert.equal(upperCase.length, 1);
});

test("readAudit eventPrefix filter matches browser: events but not task_completed", () => {
  recordAudit({ event: "browser:read", ts: "2026-06-14T04:15:00.000Z", actor: "hive", taskId: "prefix-check-1", status: "ok" });
  recordAudit({ event: "browser:job_created", ts: "2026-06-14T04:16:00.000Z", actor: "hive", taskId: "prefix-check-2", status: "created" });
  recordAudit({ event: "task_completed", ts: "2026-06-14T04:17:00.000Z", actor: "hive", taskId: "prefix-check-3", status: "review" });

  const filtered = readAudit({ eventPrefix: "browser:" } as never);
  assert.ok(filtered.some((e) => e.event === "browser:read" && e.taskId === "prefix-check-1"));
  assert.ok(filtered.some((e) => e.event === "browser:job_created" && e.taskId === "prefix-check-2"));
  assert.ok(!filtered.some((e) => e.event === "task_completed"));
});

test("readAudit since/until bounds entries by ts", () => {
  recordAudit({ event: "browser:read", ts: "2026-07-15T23:00:00.000Z", actor: "hive", taskId: "since-until-before", status: "ok" });
  recordAudit({ event: "browser:read", ts: "2026-07-16T12:00:00.000Z", actor: "hive", taskId: "since-until-inside", status: "ok" });
  recordAudit({ event: "browser:read", ts: "2026-07-17T00:00:00.000Z", actor: "hive", taskId: "since-until-after", status: "ok" });

  const bounded = readAudit({ since: "2026-07-16T00:00:00.000Z", until: "2026-07-16T23:59:59.999Z" } as never);
  assert.ok(bounded.some((e) => e.taskId === "since-until-inside"));
  assert.ok(!bounded.some((e) => e.taskId === "since-until-before"));
  assert.ok(!bounded.some((e) => e.taskId === "since-until-after"));
});
