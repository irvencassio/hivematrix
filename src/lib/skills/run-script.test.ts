import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Skill } from "./contracts";

const TMP = mkdtempSync(join(tmpdir(), "hm-scriptskill-"));
const origHome = process.env.HOME;
process.env.HOME = TMP;

const { runScriptSkill, getScriptRun } = await import("./run-script");

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

function scriptSkill(over: Partial<Skill> = {}): Skill {
  return {
    name: "demo", description: "", tags: [], body: 'echo "hello $SKILL_INPUT"',
    source: "operator", createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, kind: "script", interpreter: "bash", ...over,
  };
}

async function waitForDone(runId: string, ms = 5000): Promise<ReturnType<typeof getScriptRun>> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = getScriptRun(runId);
    if (r && r.status === "done") return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  return getScriptRun(runId);
}

test("a trusted script skill executes deterministically and logs output + exit 0", async () => {
  const r = runScriptSkill(scriptSkill(), "world");
  assert.equal(r.ok, true);
  assert.ok(r.run?.runId);
  const done = await waitForDone(r.run!.runId);
  assert.equal(done?.status, "done");
  assert.equal(done?.exitCode, 0);
  assert.match(done!.log, /hello world/);
});

test("a non-zero exit is captured", async () => {
  const r = runScriptSkill(scriptSkill({ body: "exit 3" }), "");
  const done = await waitForDone(r.run!.runId);
  assert.equal(done?.exitCode, 3);
});

test("an UNTRUSTED script skill is refused (never executes code)", () => {
  const r = runScriptSkill(scriptSkill({ trusted: false }), "x");
  assert.equal(r.ok, false);
  assert.match(r.error!, /untrusted/i);
});

test("an instruction skill is not runnable as a script", () => {
  const r = runScriptSkill(scriptSkill({ kind: "instruction" }), "x");
  assert.equal(r.ok, false);
  assert.match(r.error!, /not a script/i);
});

test("getScriptRun returns null for an unknown run id", () => {
  assert.equal(getScriptRun("nope-12345"), null);
});
