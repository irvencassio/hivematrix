import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorkflowRegistry,
  getWorkflowRegistry,
  summarizeWorkflow,
  type WorkflowDefinition,
} from "./registry";
import { HEYGEN_PORTAL_VIDEO_WORKFLOW } from "./heygen-portal";

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

test("the default registry includes the HeyGen portal video workflow", () => {
  const reg = getWorkflowRegistry();
  const heygen = reg.get("heygen.portal_video_from_script");
  assert.ok(heygen, "heygen workflow should be registered");
  assert.equal(heygen.lane, "browser");
  assert.equal(heygen.capability, "workflow.run");
});

test("the HeyGen workflow declares readiness, handoffs, domains, and a runbook", () => {
  const w = HEYGEN_PORTAL_VIDEO_WORKFLOW;
  assert.equal(w.readiness.required, true);
  assert.equal(w.readiness.siteId, "heygen");
  assert.ok(w.routing.domains.includes("app.heygen.com"));
  assert.equal(w.runbook, "docs/runbooks/heygen-portal-video-pipeline.md");
  assert.equal(w.handler, "heygen-portal-video");
  const handoffs = w.handoffPoints.join("\n").toLowerCase();
  for (const marker of [/login|sign in/, /two[- ]factor|2fa/, /captcha/, /file picker/, /preview/, /export/]) {
    assert.match(handoffs, marker);
  }
});

test("the registry matches HeyGen by domain and by phrase", () => {
  const reg = getWorkflowRegistry();
  assert.equal(reg.match({ domains: ["app.heygen.com"] })?.id, "heygen.portal_video_from_script");
  assert.equal(reg.match({ domains: ["www.app.heygen.com"] })?.id, "heygen.portal_video_from_script"); // subdomain
  assert.equal(reg.match({ text: "make a heygen video from this script" })?.id, "heygen.portal_video_from_script");
  assert.equal(reg.match({ text: "do something unrelated" }), null);
});

test("summarizeWorkflow returns a compact, secret-free shape", () => {
  const s = summarizeWorkflow(HEYGEN_PORTAL_VIDEO_WORKFLOW);
  assert.equal(s.id, "heygen.portal_video_from_script");
  assert.equal(s.runbook, "docs/runbooks/heygen-portal-video-pipeline.md");
  assert.ok(s.name && s.lane);
});

test("no registered workflow definition leaks secrets", () => {
  const blob = JSON.stringify(getWorkflowRegistry().list());
  assert.doesNotMatch(blob, /password|cookie|secret|credentialRef|\btoken\b/i);
});
