/**
 * P1.5 prover: skill_run, end to end — but honestly split across the real
 * process boundary the Flash loop actually crosses.
 *
 * In production, Flash spawns a REAL `claude` child that talks to the Flash
 * MCP server (a separate process), which proxies tool calls over HTTP to the
 * daemon's `POST /bee/<tool>` route → `executeLaneTool`. In a unit test the
 * `claude` child is FAKED (via `options.__spawn` in loop.ts / loop.test.ts) —
 * a faked child's `tool_result` line is a CANNED string the test authors
 * wrote, so driving the fake-claude path alone would only prove "the loop
 * can parse a line we invented," never that a skill actually ran anywhere.
 * The fake child cannot cross the real MCP/daemon process boundary, so real
 * sandbox execution can't be proven on that path at all.
 *
 * So this file proves the two real layers SEPARATELY, honestly:
 *
 *   Test A — DISPATCH LAYER (the real execution Flash reaches): seeds a real
 *   trusted `script` skill on disk in a temp brain root, then calls
 *   `executeLaneTool("skill_run", …)` directly — the exact function the
 *   `/bee/<tool>` route invokes. This is the genuine "skill_run → sandbox
 *   executes → result" proof: the returned string is the script's REAL stdout
 *   (runSkillSandboxed actually spawned a shell), not a canned value.
 *
 *   Test B — STREAM LAYER (flash-loop integration): drives
 *   `consumeFlashStreamLine` (the pure stream-json → FlashEmitter mapper used
 *   by the real loop) with a canned `tool_use`/`tool_result` pair for
 *   `skill_run`, mirroring the existing `brain_search` FIFO test in
 *   loop.test.ts, and asserts the loop machinery surfaces the tool call
 *   correctly. This proves the STREAM plumbing, not the sandbox — that's
 *   Test A's job.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { executeLaneTool, type LaneToolContext } from "@/lib/orchestrator/lane-tools";
import { consumeFlashStreamLine, createFlashStreamState } from "./loop";
import { StreamParser } from "@/lib/orchestrator/stream-parser";
import type { FlashEmitter } from "./types";

// ------------------------------------------------------------------
// Test A setup — a real temp brain root, same trick as lane-tools.test.ts:
// a fake HOME + ~/.hivematrix/config.json pointing memory.brainRootDir at a
// scratch dir, since configuredBrainRootDir() reads that file fresh every call.
// ------------------------------------------------------------------

const SKILL_TMP = mkdtempSync(join(tmpdir(), "hm-skill-run-prover-"));
const SKILL_HOME = join(SKILL_TMP, "home");
const SKILL_BRAIN = join(SKILL_TMP, "brain");
mkdirSync(join(SKILL_HOME, ".hivematrix"), { recursive: true });
writeFileSync(
  join(SKILL_HOME, ".hivematrix", "config.json"),
  JSON.stringify({ memory: { brainRootDir: SKILL_BRAIN } }),
);
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = SKILL_HOME;

const { upsertSkill, readSkill } = await import("@/lib/skills/store");

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(SKILL_TMP, { recursive: true, force: true });
});

function ctx(): LaneToolContext {
  return { projectPath: SKILL_TMP, project: "hivematrix", requestedBy: "test" };
}

function fakeEmitter(): FlashEmitter & {
  toolStarts: Array<{ name: string; args: string }>;
  toolResults: Array<{ name: string; ok: boolean; summary: string }>;
} {
  const toolStarts: Array<{ name: string; args: string }> = [];
  const toolResults: Array<{ name: string; ok: boolean; summary: string }> = [];
  return {
    toolStarts,
    toolResults,
    token: () => {},
    toolStart: (name, args_summary) => toolStarts.push({ name, args: args_summary }),
    toolResult: (name, ok, summary) => toolResults.push({ name, ok, summary }),
    escalated: () => {},
    done: () => {},
  };
}

// ------------------------------------------------------------------
// Test A — dispatch layer: real sandbox execution via executeLaneTool
// ------------------------------------------------------------------

test("Test A: skill_run dispatch layer — a trusted script skill actually runs in the sandbox and returns real stdout", async () => {
  await upsertSkill({
    name: "system-echo",
    description: "prover: echoes a marker so the test can confirm real execution",
    body: 'echo "skill-ran-ok"',
    source: "test",
    kind: "script",
    interpreter: "bash",
    trusted: true,
  });

  const out = await executeLaneTool("skill_run", { name: "system-echo" }, ctx());

  // The REAL stdout from a REAL spawned shell — not a canned string.
  assert.match(out, /skill-ran-ok/, `expected real sandbox stdout in reply, got: ${out}`);

  const s = await readSkill("system-echo");
  assert.equal(s?.useCount, 1, "recordSkillOutcome must fire on a real run");
  assert.equal(s?.failures, 0);
});

test("Test A (strengthener): an untrusted, non-probation script skill is refused and never reaches the sandbox", async () => {
  await upsertSkill({
    name: "system-echo-untrusted",
    description: "prover: must NOT run",
    body: 'echo "should-never-run"',
    source: "test",
    kind: "script",
    interpreter: "bash",
    trusted: false,
  });

  const out = await executeLaneTool("skill_run", { name: "system-echo-untrusted" }, ctx());

  assert.match(out, /untrusted script/i);
  assert.doesNotMatch(out, /should-never-run/);
  const s = await readSkill("system-echo-untrusted");
  assert.equal(s?.useCount, 0, "a refused run must not be recorded as a use");
});

// ------------------------------------------------------------------
// Test B — stream layer: flash-loop surfaces a skill_run tool_use/tool_result
// pair, mirroring loop.test.ts's "tool_use then tool_result pairs by FIFO
// order" brain_search test. Pure — consumeFlashStreamLine needs no `claude`
// binary, so this always runs (no skip guard).
// ------------------------------------------------------------------

test("Test B: consumeFlashStreamLine surfaces a skill_run tool_use/tool_result pair", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();

  const assistantLine = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "skill_run", input: { name: "system-echo" } }] },
  });
  consumeFlashStreamLine(assistantLine, parser, state, emit);
  assert.equal(emit.toolStarts.length, 1);
  assert.equal(emit.toolStarts[0].name, "skill_run");

  // The result content mirrors the exact shape executeSkillRun (lane-tools.ts)
  // produces for a successful trusted script run.
  const resultContent = 'Skill "system-echo" ran successfully. Output:\nskill-ran-ok';
  const userLine = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", content: resultContent, is_error: false }] },
  });
  consumeFlashStreamLine(userLine, parser, state, emit);

  assert.equal(emit.toolResults.length, 1);
  assert.equal(emit.toolResults[0].name, "skill_run");
  assert.equal(emit.toolResults[0].ok, true);
  assert.equal(emit.toolResults[0].summary, resultContent);
});
