import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorkflowRegistry,
  getWorkflowRegistry,
  summarizeWorkflow,
  type WorkflowDefinition,
} from "./registry";

function def(id: string, patch: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id, name: "X", description: "x", lane: "browser", capability: "workflow.run",
    inputSchema: [{ name: "text", type: "string", required: true, description: "x" }],
    readiness: { required: false, note: "none" },
    approvalPolicy: { mode: "manual", note: "n" },
    handoffPoints: [], artifacts: [], runbook: "docs/x.md",
    routing: { domains: [], phrases: [], tags: [] }, handler: "noop",
    ...patch,
  };
}

test("registry rejects duplicate workflow ids", () => {
  assert.throws(() => createWorkflowRegistry([def("a"), def("a")]), /duplicate|unique/i);
  const ok = createWorkflowRegistry([def("a"), def("b")]);
  assert.equal(ok.list().length, 2);
});

test("normalize rejects secret-looking fields in a definition", () => {
  assert.throws(() => createWorkflowRegistry([def("a", { handler: "x", ...( { credentialRef: "y" } as object) } as never)]), /secret|not allowed/i);
});

test("the default registry includes at least two workflows incl. the research brief", () => {
  const reg = getWorkflowRegistry();
  assert.ok(reg.list().length >= 2, "expected two or more registered workflows");
  const brief = reg.get("content.research_brief");
  assert.ok(brief, "content.research_brief should be registered");
  assert.equal(brief.lane, "review");
  assert.equal(brief.readiness.required, false); // no external side effect / gate
  assert.equal(brief.runbook, "docs/runbooks/content-research-brief.md");
});

test("the registry matches the research brief workflow from natural-language phrases", () => {
  const reg = getWorkflowRegistry();
  assert.equal(reg.match({ text: "prepare a research brief on local AI video tools" })?.id, "content.research_brief");
  assert.equal(reg.match({ text: "I need a content brief" })?.id, "content.research_brief");
});

test("summarizeWorkflow returns a compact, secret-free shape", () => {
  const brief = getWorkflowRegistry().get("content.research_brief")!;
  const s = summarizeWorkflow(brief);
  assert.equal(s.id, "content.research_brief");
  assert.equal(s.runbook, "docs/runbooks/content-research-brief.md");
  assert.ok(s.name && s.lane);
});

test("no registered workflow definition leaks secrets", () => {
  const blob = JSON.stringify(getWorkflowRegistry().list());
  assert.doesNotMatch(blob, /password|cookie|secret|credentialRef|\btoken\b/i);
});
