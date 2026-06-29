import test from "node:test";
import assert from "node:assert/strict";

import { resolveParentDecision } from "./coordinator";
import type { ParentContextSource } from "./parent-context";
import type { ParentDecisionBlocker } from "./parent-blocker";

const usageParent: ParentContextSource = {
  title: "Usage panel traffic-light thresholds",
  description:
    "For the 7-day window, display green/yellow/red based on the % to the number of days in. " +
    "If we are on day 1 of the 7-day and usage is at 15% of the weekly, show red (14.3% per-day budget). " +
    "If we are on day 7 and usage is 82%, show green (less than the 6-day max of 85.7%).",
  intake: null,
};

test("case 4: a 'what period?' ambiguity resolves from the parent's 7-day window", () => {
  const blocker: ParentDecisionBlocker = {
    ambiguity: "What period are you referring to?",
    parentExcerpt: "",
    options: [],
    recommendedDefault: "",
    confidence: 0.1,
  };
  const r = resolveParentDecision(usageParent, blocker);
  assert.equal(r.resolved, true);
  assert.ok(!r.escalate, "no operator escalation");
  assert.match(r.answer ?? "", /7-day/);
  assert.match(r.answer ?? "", /14\.3%/);
  assert.match(r.answer ?? "", /100 \/ 7/);
});

test("a grounded recommended default with adequate confidence is accepted", () => {
  const blocker: ParentDecisionBlocker = {
    ambiguity: "Which max threshold should green require?",
    parentExcerpt: "less than the 6-day max of 85.7%",
    options: ["85.7%", "100%"],
    recommendedDefault: "85.7%",
    confidence: 0.8,
  };
  const r = resolveParentDecision(usageParent, blocker);
  assert.equal(r.resolved, true);
  assert.match(r.answer ?? "", /85\.7%/);
});

test("case 5: a product-facing ambiguity with no parent anchor escalates to the operator", () => {
  const parent: ParentContextSource = {
    title: "Pricing page",
    description: "Build a pricing page for the app.",
    intake: null,
  };
  const blocker: ParentDecisionBlocker = {
    ambiguity: "Which pricing tiers and prices should we show?",
    parentExcerpt: "",
    options: ["$9 / $29 / $99", "single $49 plan"],
    recommendedDefault: "$9 / $29 / $99",
    confidence: 0.2,
  };
  const r = resolveParentDecision(parent, blocker);
  assert.equal(r.resolved, false);
  assert.equal(r.escalate, true);
  assert.equal(r.escalateReason, "product_decision");
});

test("a destructive ambiguity always escalates even with a recommended default", () => {
  const parent: ParentContextSource = { title: "DB cleanup", description: "Clean up stale rows.", intake: null };
  const blocker: ParentDecisionBlocker = {
    ambiguity: "Should I delete and drop the legacy table?",
    parentExcerpt: "",
    options: ["drop legacy_users", "keep it"],
    recommendedDefault: "drop legacy_users",
    confidence: 0.9,
  };
  const r = resolveParentDecision(parent, blocker);
  assert.equal(r.escalate, true);
  assert.equal(r.escalateReason, "destructive");
});

test("no anchor, no usable default → escalate as insufficient_context", () => {
  const parent: ParentContextSource = { title: "Tweak", description: "Make it better.", intake: null };
  const blocker: ParentDecisionBlocker = {
    ambiguity: "Which value did you have in mind for the limit?",
    parentExcerpt: "",
    options: [],
    recommendedDefault: "",
    confidence: 0.0,
  };
  const r = resolveParentDecision(parent, blocker);
  assert.equal(r.escalate, true);
  assert.equal(r.escalateReason, "insufficient_context");
});
