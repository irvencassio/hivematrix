import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync, unlinkSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// approval.ts resolves APPROVALS_DIR from HOME at import time — set it first.
const TMP = mkdtempSync(join(tmpdir(), "hm-approval-test-"));
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { requestCheckpointApproval, readCheckpointDecision, getPendingApprovals, resolveApproval, generateHookScript, generateHookSettings } =
  await import("./approval");
const { setAutoApprovalPolicy } = await import("@/lib/voice/auto-approval-policy");
const { setAutonomyLevel } = await import("@/lib/config/autonomy");

test.after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test.afterEach(() => {
  setAutoApprovalPolicy({ enabled: false, allowCheckpoints: false, allowLowRiskTools: false });
  setAutonomyLevel("standard"); // restore the default between tests
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

// ── generateHookScript: the PreToolUse hook consults the autonomy dial ────────
//
// The autonomy level is resolved Node-side at generation time as a baked-in
// FALLBACK, but the MCP branch re-reads it live from config.json at run time so
// a dial flip reaches an already-running task. These tests actually execute the
// generated hook with a synthetic tool_name/tool_input on stdin and observe
// whether it (a) exits 0 immediately with no approval request written, or (b)
// writes an approval request file and blocks polling for a decision — which is
// what "still requires approval" looks like from the outside.

const APPROVALS_DIR_TEST = join(TMP, ".hivematrix", "approvals");

/**
 * Run a generated hook script with a synthetic tool call and report whether it
 * wrote a new approval-request file. Approval-required calls block in a
 * polling loop, so the process is killed after `timeoutMs` — the request file
 * (written before the poll loop starts) is what tells us approval was asked
 * for, not the exit code.
 */
function runHook(scriptPath: string, toolName: string, toolArgs: string = "{}", timeoutMs = 1500): { exitedZero: boolean; requestedApproval: boolean } {
  const before = new Set(existsSync(APPROVALS_DIR_TEST) ? readdirSync(APPROVALS_DIR_TEST) : []);
  const input = JSON.stringify({ tool_name: toolName, tool_input: JSON.parse(toolArgs) });
  const result = spawnSync(scriptPath, [], {
    input,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const after = existsSync(APPROVALS_DIR_TEST) ? readdirSync(APPROVALS_DIR_TEST) : [];
  const newFiles = after.filter((f) => !before.has(f));
  // Clean up anything this run created (request/decision files) so later
  // assertions in other tests aren't polluted.
  for (const f of newFiles) {
    try { unlinkSync(join(APPROVALS_DIR_TEST, f)); } catch { /* best effort */ }
  }
  return {
    exitedZero: result.status === 0,
    requestedApproval: newFiles.some((f) => f.endsWith(".json")),
  };
}

test("generateHookScript: autonomous mode auto-approves a plain MCP tool with no floor hit", () => {
  setAutonomyLevel("autonomous");
  const scriptPath = generateHookScript("hook_autonomous_plain");
  const { exitedZero, requestedApproval } = runHook(scriptPath, "mcp__weather__get_forecast");
  assert.equal(requestedApproval, false, "no approval request should be written");
  assert.equal(exitedZero, true, "the hook should exit 0 (allow) immediately");
});

test("generateHookScript: autonomous mode still requires approval for a deploy/release-named tool (hard floor)", () => {
  setAutonomyLevel("autonomous");
  const scriptPath = generateHookScript("hook_autonomous_deploy_name");
  const { requestedApproval } = runHook(scriptPath, "mcp__deploy__run_release");
  assert.equal(requestedApproval, true, "release/deploy tool names must still hit the safety floor");
});

test("generateHookScript: autonomous mode still requires approval when args look destructive (hard floor)", () => {
  setAutonomyLevel("autonomous");
  const scriptPath = generateHookScript("hook_autonomous_destructive_args");
  const { requestedApproval } = runHook(scriptPath, "mcp__files__op", JSON.stringify({ cmd: "rm -rf /tmp/x" }));
  assert.equal(requestedApproval, true, "destructive rm in args must still hit the safety floor");
});

test("generateHookScript: standard mode requires approval for MCP tools, unchanged", () => {
  setAutonomyLevel("standard");
  const scriptPath = generateHookScript("hook_standard_plain");
  const { requestedApproval } = runHook(scriptPath, "mcp__weather__get_forecast");
  assert.equal(requestedApproval, true, "standard mode must keep asking for every MCP tool call");
});

test("generateHookScript: manual mode requires approval for MCP tools, unchanged", () => {
  setAutonomyLevel("manual");
  const scriptPath = generateHookScript("hook_manual_plain");
  const { requestedApproval } = runHook(scriptPath, "mcp__weather__get_forecast");
  assert.equal(requestedApproval, true, "manual mode must keep asking for every MCP tool call");
});

test("generateHookScript: a live dial flip (standard→autonomous) reaches an already-generated hook", () => {
  // Generate the hook while the config says "standard" — its baked fallback is
  // "standard", which would require approval for a plain MCP tool.
  setAutonomyLevel("standard");
  const scriptPath = generateHookScript("hook_live_flip");
  assert.equal(
    runHook(scriptPath, "mcp__weather__get_forecast").requestedApproval,
    true,
    "with config=standard the hook must still ask",
  );
  // Now flip the live config to autonomous WITHOUT regenerating the hook.
  setAutonomyLevel("autonomous");
  assert.equal(
    runHook(scriptPath, "mcp__weather__get_forecast").requestedApproval,
    false,
    "the same hook script must honor the live autonomous dial and auto-approve",
  );
  // The hard safety floor is still enforced against the live level.
  assert.equal(
    runHook(scriptPath, "mcp__deploy__run_release").requestedApproval,
    true,
    "the safety floor must hold even after a live flip to autonomous",
  );
});

test("generateHookSettings: PreToolUse matcher only targets Bash + MCP tools", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hm-hook-settings-"));
  const settingsPath = generateHookSettings("hook_matcher_task", projectDir);
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const matcher = settings.hooks.PreToolUse[0].matcher;
  assert.equal(matcher, "Bash|mcp__.*", "matcher must be narrowed to gateable tools only");
  // Sanity: the narrowed regex matches what needs gating and skips safe tools,
  // so the hook never spawns for Read/Edit/Grep/etc.
  assert.ok(/^(Bash|mcp__.*)$/.test("Bash"));
  assert.ok(/^(Bash|mcp__.*)$/.test("mcp__weather__get_forecast"));
  assert.ok(!/^(Bash|mcp__.*)$/.test("Edit"));
  assert.ok(!/^(Bash|mcp__.*)$/.test("Read"));
  rmSync(projectDir, { recursive: true, force: true });
});
