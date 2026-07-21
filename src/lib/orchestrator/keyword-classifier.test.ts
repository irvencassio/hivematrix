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
  // cto is no longer cut — architecture language routes to the real cto profile.
  assert.equal(classifyByKeywords("review the system design and infrastructure scalability"), "cto");
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

test("a design brief containing an implementation verb still routes to cto, not developer", () => {
  // The real failure this fixes: the Canopy auto-update task was titled
  // "Implement Canopy auto-update" and asked the agent to "design and implement
  // an equivalent auto-update mechanism". The developer rule matched "implement"
  // first, so architecture work ran on the coding model. Rule ORDER is the whole
  // behavior here — first match wins — so these assertions are the guard.
  assert.equal(classifyByKeywords("design and implement an equivalent auto-update mechanism"), "cto");
  assert.equal(classifyByKeywords("Implement Canopy auto-update: investigate the tech stack, then design it"), "cto");
  assert.equal(classifyByKeywords("write a design doc for the release architecture and its trade-offs"), "cto");
  assert.equal(classifyByKeywords("run a security audit and threat model of the sync endpoint"), "cto");

  // Plain implementation work — no design language — must still be developer.
  assert.equal(classifyByKeywords("fix the null deref in the parser and add a regression test"), "developer");
  assert.equal(classifyByKeywords("bump the dependency and rerun npm build"), "developer");

  // The CTO rule matches bare "design", so the designer rule MUST stay ahead of
  // it — interface work owns "design system", "information architecture" and the
  // rest of that vocabulary. These guard the ordering from either direction.
  assert.equal(classifyByKeywords("design the empty state and hover state for the sidebar"), "designer");
  assert.equal(classifyByKeywords("update the information architecture of the settings panel"), "designer");
  assert.equal(classifyByKeywords("design system tokens for typography"), "designer");
});
