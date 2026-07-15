import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-task-lookup-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  resolveTask, logTail, summarizeOutput, formatTaskLine, formatTaskDetail,
  getTaskDetailText, listTasksText, boardSummaryLine,
} = await import("./task-lookup");

_resetDbForTests();

test.after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });

function seed(id: string, title: string, status: string, extra: Record<string, unknown> = {}): void {
  const cols = ["_id", "title", "description", "project", "projectPath", "status", "model", "error", "logs", "output", "reviewState", "updatedAt"];
  const vals = [id, title, extra.description ?? "", extra.project ?? "hivematrix", "/Users/x", status, extra.model ?? null, extra.error ?? null,
    extra.logs ?? "[]", extra.output ?? "{}", extra.reviewState ?? null, extra.updatedAt ?? "2026-07-15 18:00:00"];
  getDb().prepare(`INSERT INTO tasks (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
}

const FAIL_LOGS = JSON.stringify([
  { timestamp: "2026-07-15T18:43:33Z", type: "tool_use", content: "Bash: npm test" },
  { timestamp: "2026-07-15T18:44:11Z", type: "tool_result", content: "ℹ tests 2949\nℹ pass 2941\nℹ fail 7" },
  { timestamp: "2026-07-15T18:44:18Z", type: "tool_use", content: "Bash: cp /tmp/console_taskAB.ts src/daemon/console.ts" },
]);

test("resolveTask finds by exact id, id-prefix, and fuzzy title", async () => {
  seed("abc123def456", "HiveMatrix UI: Add 5h/7d toggles to header", "failed", { model: "claude-sonnet-5", error: "Exited with code: 1", logs: FAIL_LOGS });
  assert.equal((await resolveTask("abc123def456"))?._id, "abc123def456", "exact id");
  assert.equal((await resolveTask("abc123"))?._id, "abc123def456", "id prefix");
  assert.equal((await resolveTask("5h/7d toggles"))?._id, "abc123def456", "fuzzy title contains");
  assert.equal(await resolveTask("nonexistent-xyz"), null, "no match → null");
  assert.equal(await resolveTask("  "), null, "blank → null");
});

test("formatTaskDetail surfaces status, error, and the log tail (diagnose a failure)", async () => {
  const t = await resolveTask("abc123def456");
  const detail = formatTaskDetail(t!);
  assert.match(detail, /Status: failed/);
  assert.match(detail, /model claude-sonnet-5/);
  assert.match(detail, /Error: Exited with code: 1/);
  assert.match(detail, /Recent activity/);
  assert.match(detail, /fail 7/, "the log tail carries the actual failure signal");
  assert.match(detail, /console_taskAB\.ts/, "shows the last action before exit");
});

test("logTail truncates long content, keeps only the last N, flattens whitespace", () => {
  const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ type: "text", content: "line " + i })));
  const tail = logTail(many, 5);
  assert.equal(tail.length, 5);
  assert.equal(tail[4], "[text] line 19");
  const long = logTail(JSON.stringify([{ type: "tool_result", content: "x".repeat(500) }]), 5);
  assert.ok(long[0].endsWith("…") && long[0].length < 200, "long content truncated");
  assert.deepEqual(logTail("not json", 5), [], "bad logs → empty, never throws");
});

test("summarizeOutput prefers summary/result/text, else compact json, else empty", () => {
  assert.equal(summarizeOutput({ summary: "did the thing" }), "did the thing");
  assert.equal(summarizeOutput({ result: "ok" }), "ok");
  assert.equal(summarizeOutput({}), "");
  assert.equal(summarizeOutput("{}"), "");
  assert.match(summarizeOutput({ files: 3, note: "x" }), /files/);
});

test("getTaskDetailText returns a helpful miss when nothing matches", async () => {
  const miss = await getTaskDetailText("does-not-exist");
  assert.match(miss, /No task found/);
  assert.match(miss, /list_tasks/, "points at the list tool");
});

test("listTasksText lists recent tasks, filters by status, and shows a board summary", async () => {
  seed("d2", "Second task", "review", { reviewState: "ready_for_review", updatedAt: "2026-07-15 19:00:00" });
  seed("d3", "Third task", "done", { updatedAt: "2026-07-15 17:00:00" });

  const all = await listTasksText({});
  assert.match(all, /Board: /, "includes a status-count summary");
  assert.match(all, /Second task/);
  // most-recent-first ordering: d2 (19:00) before abc (18:00) before d3 (17:00)
  assert.ok(all.indexOf("Second task") < all.indexOf("Third task"));

  const failed = await listTasksText({ status: "failed" });
  assert.match(failed, /5h\/7d toggles/);
  assert.doesNotMatch(failed, /Second task/, "status filter excludes non-failed");

  assert.match(await listTasksText({ status: "no-such-status" }), /No tasks with status/);
});

test("formatTaskLine + boardSummaryLine are compact and status-iconned", () => {
  const line = formatTaskLine({ _id: "abcdef123456", title: "T", status: "failed", model: "sonnet" } as never);
  assert.match(line, /^abcdef12 {2}✗ failed — T \(sonnet\)/);
  assert.match(boardSummaryLine(), /Board: .*failed/);
});
