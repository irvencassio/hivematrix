/**
 * Prover (P3.4) — voice-turn self-improvement escalation: "update hivematrix
 * so it can read my calendar" must land a Task row with `projectPath` pointed
 * at the HiveMatrix repo, `workflow: "work"`, and a voice-origin marker.
 *
 * Honest-prover note (mirrors the P1.5/P2.5 provers): the real `/voice/turn`
 * path is Flash/LLM-driven, and a faked `claude` child process can't cross
 * the MCP→daemon boundary to actually create the Task — that tool dispatch
 * runs in the DAEMON process (server.ts's `POST /flash/tool/:name` route),
 * not in the child MCP stdio process the fake `claude` would stand in for.
 * So this test drives the REAL dispatch layer Flash reaches: it calls
 * `dispatchFlashOnlyTool("escalate_to_task", ...)` directly — the exact
 * function that route invokes (see flash-mcp.ts's `FLASH_MCP_SERVER_JS`,
 * which POSTs `/flash/tool/escalate_to_task` for this tool) — against a real
 * "voice" flash session (`store.ts`'s `createSession`) and a temp
 * `~/.hivematrix/config.json` pinning `selfImprove.repoPath` so
 * `selfImproveRepoPath()` (P3.2) is deterministic. This proves the P3.1–P3.3
 * wiring end to end, short only of the LLM itself deciding to emit the tool
 * call — exactly the boundary the earlier provers also draw the line at.
 *
 * Test 2 closes the loop from the other end (pure, no dispatch): it asserts
 * `detectCommandIntent` hands this exact utterance off as `{ kind: "none" }`,
 * i.e. the P3.3 regex guard does NOT intercept it — which is what lets the
 * utterance reach Flash in the first place and trigger the escalation above.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DB_PATH = process.env.HIVEMATRIX_DB_PATH;

const TEMP_HOME = mkdtempSync(join(tmpdir(), "hm-self-improve-prover-home-"));
const TEMP_REPO = mkdtempSync(join(tmpdir(), "hm-self-improve-prover-repo-"));
mkdirSync(join(TEMP_HOME, ".hivematrix"), { recursive: true });
writeFileSync(
  join(TEMP_HOME, ".hivematrix", "config.json"),
  JSON.stringify({ selfImprove: { repoPath: TEMP_REPO } }),
);

process.env.HOME = TEMP_HOME;
process.env.HIVEMATRIX_DB_PATH = join(TEMP_HOME, "test.db");

const { _resetDbForTests, Task } = await import("@/lib/db");
_resetDbForTests();

const { dispatchFlashOnlyTool } = await import("./flash-mcp");
const { createSession } = await import("./store");
const { detectCommandIntent } = await import("@/lib/voice/command-intent");
const { VOICE_ORIGIN, markVoiceOrigin } = await import("@/lib/voice/loop-closer");

test.after(() => {
  _resetDbForTests();
  if (ORIGINAL_DB_PATH) process.env.HIVEMATRIX_DB_PATH = ORIGINAL_DB_PATH;
  else delete process.env.HIVEMATRIX_DB_PATH;
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  else delete process.env.HOME;
  rmSync(TEMP_HOME, { recursive: true, force: true });
  rmSync(TEMP_REPO, { recursive: true, force: true });
});

test("self-improvement escalation lands in the HiveMatrix repo with workflow work + voice-origin", async () => {
  const session = createSession("voice", "prover-peer");
  assert.equal(session.channel, "voice");

  const result = await dispatchFlashOnlyTool(
    "escalate_to_task",
    {
      title: "Read calendar",
      description: "update hivematrix so it can read my calendar",
      kind: "self-improvement",
    },
    { brainRoot: null, sessionId: session.id },
  );

  const match = result.match(/^Escalated to task (\S+):/);
  assert.ok(match, `expected "Escalated to task <id>:" prefix, got: ${result}`);
  const taskId = match![1];

  const task = await Task.findById(taskId);
  assert.ok(task, `expected a task row for id ${taskId}`);

  // Self-improvement routing overrode the homedir() default and landed on the
  // configured repo path (proves selfImproveRepoPath() read our temp config).
  assert.equal(task!.projectPath, TEMP_REPO);
  assert.notEqual(task!.projectPath, homedir());

  assert.equal(task!.workflow, "work");

  // Voice-origin marker, asserted via the loop-closer's own marker shape.
  assert.equal(task!.output.origin, VOICE_ORIGIN);
  assert.deepEqual(task!.output, markVoiceOrigin());

  assert.match(task!.description, /Superpowers/);
  assert.match(task!.description, /Do NOT release/);
  assert.ok(
    task!.description.endsWith("update hivematrix so it can read my calendar"),
    "expected the Superpowers prefix followed by the original description",
  );
});

test("the utterance is left for Flash (regex de-confliction)", () => {
  const intent = detectCommandIntent("update hivematrix so it can read my calendar");
  assert.deepEqual(intent, { kind: "none" });
});

test("control: a non-self-improvement escalation from a non-voice session does not get the self-improve routing", async () => {
  const session = createSession("chat", "prover-peer-2");
  assert.equal(session.channel, "chat");

  const result = await dispatchFlashOnlyTool(
    "escalate_to_task",
    { title: "X", description: "book a flight to NYC" },
    { brainRoot: null, sessionId: session.id },
  );

  const match = result.match(/^Escalated to task (\S+):/);
  assert.ok(match, `expected "Escalated to task <id>:" prefix, got: ${result}`);
  const taskId = match![1];

  const task = await Task.findById(taskId);
  assert.ok(task, `expected a task row for id ${taskId}`);

  assert.notEqual(task!.projectPath, TEMP_REPO);
  assert.equal(task!.projectPath, homedir());
  assert.doesNotMatch(task!.description, /Superpowers/);
  assert.equal(task!.output.origin, undefined);
});
