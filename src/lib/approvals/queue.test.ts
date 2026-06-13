import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-approvals-queue-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { requestCheckpointApproval } = await import("@/lib/orchestrator/approval");
const { classifyApproval, buildApprovalQueue } = await import("./queue");

const APPROVALS_DIR = join(TMP, ".hivematrix", "approvals");

test.after(() => {
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("classifyApproval distinguishes content, checkpoint, and tool gates", () => {
  assert.equal(classifyApproval({ taskId: "x", timestamp: "checkpoint-content", tool: "", command: "", context: "" }), "content");
  assert.equal(classifyApproval({ taskId: "x", timestamp: "checkpoint-plan", tool: "", command: "", context: "" }), "checkpoint");
  assert.equal(classifyApproval({ taskId: "x", timestamp: "checkpoint-completion", tool: "", command: "", context: "" }), "checkpoint");
  assert.equal(classifyApproval({ taskId: "x", timestamp: "1718000000", tool: "Bash", command: "rm -rf", context: "" }), "tool");
});

test("buildApprovalQueue merges checkpoint, content, and stuck gates into one list", () => {
  requestCheckpointApproval({ id: "run_a", gate: "plan", goal: "Ship A", summary: "2 tasks" });
  requestCheckpointApproval({ id: "task_c", gate: "content", goal: "Publish: Launch", summary: "4 renditions" });
  mkdirSync(APPROVALS_DIR, { recursive: true });
  writeFileSync(
    join(APPROVALS_DIR, "stuck-task_s-ts1.json"),
    JSON.stringify({ taskId: "task_s", timestamp: "ts1", reason: "needs a key", lastOutput: "out", options: ["retry", "skip", "abort"], missionId: null, source: "agent" }),
  );

  const queue = buildApprovalQueue();

  const checkpoint = queue.find((q) => q.taskId === "run_a");
  assert.ok(checkpoint && checkpoint.kind === "checkpoint");
  assert.deepEqual(checkpoint!.options, ["approve", "deny"]);

  const content = queue.find((q) => q.taskId === "task_c");
  assert.ok(content && content.kind === "content");
  assert.match(content!.title, /Publish: Launch/);

  const stuck = queue.find((q) => q.taskId === "task_s");
  assert.ok(stuck && stuck.kind === "stuck");
  assert.deepEqual(stuck!.options, ["retry", "skip", "abort"]);
  assert.match(stuck!.title, /needs a key/);
});
