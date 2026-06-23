import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// approval.ts resolves APPROVALS_DIR from HOME at import time — set it first.
const TMP = mkdtempSync(join(tmpdir(), "hm-approval-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { requestCheckpointApproval, readCheckpointDecision, getPendingApprovals, resolveApproval } =
  await import("./approval");
const { setAutoApprovalPolicy } = await import("@/lib/voice/auto-approval-policy");

test.after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test.afterEach(() => {
  setAutoApprovalPolicy({ enabled: false, allowCheckpoints: false, allowLowRiskTools: false });
});

test("checkpoint approval round-trips through the shared approval store", async () => {
  const runId = "run_checkpoint_1";

  // Unresolved before a request exists.
  assert.equal(readCheckpointDecision(runId, "plan"), null);

  requestCheckpointApproval({ id: runId, gate: "plan", goal: "Ship the thing", summary: "2 tasks" });

  // The notify plane discovers it via the same pending-approvals listing.
  const pending = getPendingApprovals();
  const mine = pending.find((p) => p.taskId === runId && p.timestamp === "checkpoint-plan");
  assert.ok(mine, "checkpoint request should appear as a pending approval");
  assert.equal(mine!.command, "Ship the thing");
  assert.equal(readCheckpointDecision(runId, "plan"), null, "still pending until resolved");

  // A founder tap resolves it the same way a console/Telegram approval would.
  await resolveApproval(runId, "checkpoint-plan", "approve", "telegram");
  assert.equal(readCheckpointDecision(runId, "plan"), "approve");

  // Idempotent: re-requesting after a decision exists is a no-op.
  requestCheckpointApproval({ id: runId, gate: "plan", goal: "Ship the thing", summary: "2 tasks" });
  assert.equal(readCheckpointDecision(runId, "plan"), "approve");
});

test("a denied checkpoint reads back as denied", async () => {
  const runId = "run_checkpoint_2";
  requestCheckpointApproval({ id: runId, gate: "completion", goal: "Finish", summary: "done" });
  await resolveApproval(runId, "checkpoint-completion", "denied", "dashboard");
  assert.equal(readCheckpointDecision(runId, "completion"), "denied");
  assert.ok(existsSync(join(TMP, ".hivematrix", "approvals", `${runId}-checkpoint-completion.decision`)));
});

test("checkpoint auto-approval resolves only non-content checkpoints", () => {
  setAutoApprovalPolicy({ enabled: true, allowCheckpoints: true });

  requestCheckpointApproval({ id: "run_auto_1", gate: "plan", goal: "Plan", summary: "ready" });
  requestCheckpointApproval({ id: "task_content_auto_1", gate: "content", goal: "Publish", summary: "draft" });

  assert.equal(readCheckpointDecision("run_auto_1", "plan"), "approve");
  assert.equal(readCheckpointDecision("task_content_auto_1", "content"), null);
  assert.ok(!getPendingApprovals().some((p) => p.taskId === "run_auto_1"));
  assert.ok(getPendingApprovals().some((p) => p.taskId === "task_content_auto_1"));
});
