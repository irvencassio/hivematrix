import test from "node:test";
import assert from "node:assert/strict";

import { flightChildDecisionState, flightDecisionLabel } from "./flight-decision-label";
import { serializeParentBlocker, serializeOperatorEscalation } from "./parent-blocker";

const sample = {
  ambiguity: "What period?",
  parentExcerpt: "7-day window",
  options: ["7-day", "5-hour"],
  recommendedDefault: "7-day",
  confidence: 0.4,
};

test("a parent-decision sentinel blocker is a Flight decision (coordinator owns it)", () => {
  const state = flightChildDecisionState(serializeParentBlocker(sample));
  assert.equal(state, "parent_decision");
  assert.equal(flightDecisionLabel(state), "Needs Flight decision");
});

test("an operator-escalation sentinel blocker is an operator reply", () => {
  const state = flightChildDecisionState(serializeOperatorEscalation(sample, "Which window?"));
  assert.equal(state, "operator_decision");
  assert.equal(flightDecisionLabel(state), "Needs your reply");
});

test("a plain failure blocker / empty blocker has no decision state", () => {
  assert.equal(flightChildDecisionState("agent crashed"), null);
  assert.equal(flightChildDecisionState(null), null);
  assert.equal(flightDecisionLabel(null), "");
});
