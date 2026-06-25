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

test("the registry exposes the video script workflow", () => {
  const reg = getWorkflowRegistry();
  const script = reg.get("content.video_script_from_brief");
  assert.ok(script, "content.video_script_from_brief should be registered");
  assert.equal(script.lane, "review");
  assert.equal(script.capability, "content.script");
  assert.equal(script.handler, "content-video-script");
  // topic required; brief sources optional (the either/or is enforced in the handler).
  const required = script.inputSchema.filter((f) => f.required).map((f) => f.name);
  assert.deepEqual(required, ["topic"]);
  const fields = script.inputSchema.map((f) => f.name);
  assert.ok(fields.includes("briefMarkdown"));
  assert.ok(fields.includes("sourceRunId"));
  assert.equal(reg.match({ text: "draft a video script from the brief" })?.id, "content.video_script_from_brief");
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
