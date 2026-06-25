import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("console exposes a Workflows panel backed by /workflows", () => {
  const console = read("src/daemon/console.ts");
  assert.match(console, /renderWorkflows\(/);
  assert.match(console, /api\("\/workflows"/);
  assert.match(console, /Workflows/);
  // Shows readiness + a runbook pointer.
  assert.match(console, /runbook/i);
  // Recent runs from the run ledger.
  assert.match(console, /renderWorkflowRuns\(/);
  assert.match(console, /api\("\/workflows\/runs"/);
  // Prepare-research-brief control.
  assert.match(console, /prepareResearchBrief\(/);
  assert.match(console, /api\("\/workflows\/content\.research_brief\/prepare"/);
  assert.match(console, /id="brief_topic"/);
  // Proposed next actions + explicit execute.
  assert.match(console, /renderWorkflowActions\(/);
  assert.match(console, /executeWorkflowAction\(/);
  assert.match(console, /\/workflows\/actions\/"/);
  assert.match(console, /Proposed next actions/);
});

test("the daemon declares the workflow endpoints", () => {
  const server = read("src/daemon/server.ts");
  assert.match(server, /"\/workflows"/);
  assert.match(server, /getWorkflowRegistry/);
});

test("the workflows console panel exposes no secrets", () => {
  const console = read("src/daemon/console.ts");
  const start = console.indexOf("renderWorkflows");
  const segment = console.slice(start, start + 2000);
  assert.doesNotMatch(segment, /password|credentialRef|cookie|\.secret\b/i);
});
