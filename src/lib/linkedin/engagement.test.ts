import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLinkedInEngagementJob,
  buildLinkedInRitualDirective,
  linkedinVoiceDocPath,
  LINKEDIN_DOMAINS,
} from "./engagement";

test("the LinkedIn job is domain-locked to linkedin.com with manual approval", () => {
  const job = buildLinkedInEngagementJob();

  assert.equal(job.jobType, "site_ops");
  assert.equal(job.runMode, "attached");
  // attached run mode forces a manual human approval gate.
  assert.equal(job.approvalMode, "manual");
  assert.equal(job.requiresLogin, true);
  assert.equal(job.sessionLabel, "linkedin");
  // Navigation is confined to linkedin.com (start-url host always included).
  for (const d of LINKEDIN_DOMAINS) assert.ok(job.allowedDomains.includes(d), `${d} locked`);
  assert.ok(job.allowedDomains.every((d) => d.endsWith("linkedin.com")), "no off-domain navigation allowed");
  assert.ok(job.successCriteria.some((c) => /approval/i.test(c)), "approval is a success criterion");
});

test("voiceNote is threaded into the job steps", () => {
  const job = buildLinkedInEngagementJob({ voiceNote: "dry, concise, no emojis" });
  assert.ok(job.steps.some((s) => s.includes("dry, concise, no emojis")));
});

test("the ritual directive runs daily, plan-checkpointed, with the voice doc selected", () => {
  const directive = buildLinkedInRitualDirective({ dailyAtHour: 8, projectPath: "/tmp/x" });

  const trigger = directive.triggerPolicy as { type: string; dailyAt: number; quietHours?: unknown };
  assert.equal(trigger.type, "schedule");
  assert.equal(trigger.dailyAt, 8);
  assert.ok(trigger.quietHours, "quiet hours set so it never runs overnight");

  // The morning run is approved-by-text before it engages (W4.1 plan checkpoint).
  assert.deepEqual(directive.approvalPolicy, { checkpoint: "plan" });
  assert.equal(directive.profile, "marketing");

  const selection = directive.brainSelection as { task: string[] };
  assert.ok(selection.task.includes(linkedinVoiceDocPath()), "founder voice doc is in brain context");
  assert.match(directive.goal, /linkedin\.com/i);
  assert.match(directive.goal, /approval/i);
});
