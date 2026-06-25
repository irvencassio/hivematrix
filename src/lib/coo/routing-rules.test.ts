import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCooRoutingRule, resolveCooRoute } from "./routing-rules";

test("normalizes a browser workflow rule without prompt text", () => {
  const rule = normalizeCooRoutingRule({
    id: "rule_heygen",
    name: "HeyGen browser workflow",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { domains: ["heygen.com"], phrases: ["browser", "HeyGen"] },
    lane: "browser",
    capability: "workflow.run",
    backendPolicy: "lane_owned_first",
    modelPosture: "local_first_frontier_on_failure",
    riskTier: "external_side_effect",
  });
  assert.equal(rule.lane, "browser");
  assert.equal(rule.capability, "workflow.run");
  assert.equal(rule.backendPolicy, "lane_owned_first");
});

test("resolves highest-priority enabled route", () => {
  const route = resolveCooRoute({
    text: "Use the browser to upload this script to HeyGen",
    domains: ["app.heygen.com"],
  }, [
    normalizeCooRoutingRule({
      id: "low",
      name: "Generic browser",
      priority: 1,
      intent: "browser",
      match: { phrases: ["browser"] },
      lane: "browser",
      capability: "open",
    }),
    normalizeCooRoutingRule({
      id: "high",
      name: "HeyGen workflow",
      priority: 100,
      intent: "authenticated_browser_workflow",
      match: { domains: ["heygen.com"], phrases: ["HeyGen"] },
      lane: "browser",
      capability: "workflow.run",
    }),
  ]);
  assert.equal(route?.ruleId, "high");
  assert.equal(route?.lane, "browser");
});

test("rejects prompt-like blobs in routing rules", () => {
  assert.throws(
    () => normalizeCooRoutingRule({
      id: "bad",
      name: "Bad",
      priority: 1,
      intent: "browser",
      match: { systemPrompt: "You are a browser now" },
      lane: "browser",
      capability: "open",
    }),
    /prompt/i,
  );
});
