import test from "node:test";
import assert from "node:assert/strict";
import { runEvalSuite, EVAL_CASES, type EvalCase, type EvalResult } from "./suite";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCase(id: string, passes: boolean, durationMs = 0): EvalCase {
  return {
    id,
    name: id,
    description: id,
    async run() {
      return { caseId: id, passed: passes, durationMs };
    },
  };
}

// ---------------------------------------------------------------------------
// Suite structure
// ---------------------------------------------------------------------------

test("EVAL_CASES has exactly 6 entries", () => {
  assert.equal(EVAL_CASES.length, 6);
});

test("EVAL_CASES IDs are unique and match spec", () => {
  const ids = EVAL_CASES.map(c => c.id);
  assert.deepEqual(new Set(ids).size, 6);
  for (const expected of ["tool-chain", "extraction", "multi-turn", "ui-slice", "long-context", "repo-task"]) {
    assert.ok(ids.includes(expected), `missing case: ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// runEvalSuite aggregation
// ---------------------------------------------------------------------------

test("runEvalSuite: all pass → allPassed=true", async () => {
  const cases = [makeCase("a", true), makeCase("b", true)];
  const result = await runEvalSuite("http://localhost:8080", "test-model", { cases });
  assert.equal(result.allPassed, true);
  assert.equal(result.pass, 2);
  assert.equal(result.fail, 0);
  assert.equal(result.results.length, 2);
});

test("runEvalSuite: one fail → allPassed=false", async () => {
  const cases = [makeCase("a", true), makeCase("b", false)];
  const result = await runEvalSuite("http://localhost:8080", "test-model", { cases });
  assert.equal(result.allPassed, false);
  assert.equal(result.pass, 1);
  assert.equal(result.fail, 1);
});

test("runEvalSuite: captures errors from throwing cases", async () => {
  const errorCase: EvalCase = {
    id: "err",
    name: "err",
    description: "err",
    async run() { throw new Error("boom"); },
  };
  const result = await runEvalSuite("http://localhost:8080", "test-model", { cases: [errorCase] });
  assert.equal(result.fail, 1);
  assert.ok(result.results[0].error?.includes("boom"));
});

test("runEvalSuite: result has runAt, endpoint, modelId", async () => {
  const result = await runEvalSuite("http://localhost:8080", "my-model", { cases: [] });
  assert.equal(result.endpoint, "http://localhost:8080");
  assert.equal(result.modelId, "my-model");
  assert.ok(typeof result.runAt === "string" && result.runAt.length > 0);
});

// ---------------------------------------------------------------------------
// Stub cases (long-context, repo-task) skip cleanly without a live server
// ---------------------------------------------------------------------------

test("long-context and repo-task stubs skip without error", async () => {
  const stubs = EVAL_CASES.filter(c => c.id === "long-context" || c.id === "repo-task");
  assert.equal(stubs.length, 2);
  for (const c of stubs) {
    const result: EvalResult = await c.run("http://localhost:8080", "stub");
    assert.equal(result.passed, true, `${c.id} stub should pass`);
    assert.equal((result.output as { skipped?: boolean })?.skipped, true);
  }
});
