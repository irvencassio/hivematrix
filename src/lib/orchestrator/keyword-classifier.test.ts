import test from "node:test";
import assert from "node:assert/strict";

import { classifyByKeywords } from "./keyword-classifier";
import { getCoreAgentProfiles } from "@/lib/config/agent-profiles";

test("classifyByKeywords: unchanged rules still resolve to their surviving core id", () => {
  assert.equal(classifyByKeywords("fix the login bug and add a regression test"), "developer");
  assert.equal(classifyByKeywords("research competitive positioning for the launch"), "researcher");
  assert.equal(classifyByKeywords("write a blog post and social media caption"), "marketing");
  assert.equal(classifyByKeywords("what is the difference between TCP and UDP?"), "general");
  assert.equal(classifyByKeywords("verify this is ready to ship, run a full security review"), "qa");
  assert.equal(classifyByKeywords("design a wireframe and prototype for the new flow"), "designer");
});

test("classifyByKeywords: language that used to route to a cut profile now resolves via its alias target", () => {
  // cto → developer
  assert.equal(classifyByKeywords("review the system design and infrastructure scalability"), "developer");
  // ceo, cfo, inventor → founder
  assert.equal(classifyByKeywords("set the quarterly roadmap and strategic direction"), "founder");
  assert.equal(classifyByKeywords("calculate the burn rate and cash flow, then draft a p&l"), "founder");
  assert.equal(classifyByKeywords("we need a new capability gap filled with a new mcp"), "founder");
  // analyst → researcher
  assert.equal(classifyByKeywords("show the metrics dashboard with a cohort funnel chart"), "researcher");
});

test("classifyByKeywords: no rule ever resolves to the coordinator or a domain profile", () => {
  // Old "coo" language — falls through to null (caller defaults to developer), never auto-picks coo.
  assert.equal(classifyByKeywords("coordinate and delegate this workflow across the team, assign owners"), null);
  // Old "trader" language — falls through to null, never auto-picks trader.
  assert.equal(classifyByKeywords("ticker price target and stop-loss, RSI overbought, sector rotation"), null);
});

test("classifyByKeywords: return value is always a member of getCoreAgentProfiles() or null — never a gated/removed id", () => {
  const coreIds = new Set(getCoreAgentProfiles().map((p) => p.id));
  const probes = [
    "fix the bug", "research this", "write a newsletter", "why is the sky blue?",
    "ready to ship, run qa", "design a wireframe", "system architecture review",
    "quarterly roadmap", "cash flow forecast", "new mcp capability",
    "metrics dashboard", "coordinate and delegate", "stock ticker buy signal",
    "completely unmatched gibberish text with no keywords",
  ];
  for (const text of probes) {
    const result = classifyByKeywords(text);
    if (result !== null) assert.ok(coreIds.has(result), `"${text}" resolved to "${result}", which is not in the core roster`);
  }
});
