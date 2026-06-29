import test from "node:test";
import assert from "node:assert/strict";

import {
  parseParentDecisionBlocker,
  serializeParentBlocker,
  serializeOperatorEscalation,
  readItemBlocker,
  type ParentDecisionBlocker,
} from "./parent-blocker";

const sample: ParentDecisionBlocker = {
  ambiguity: "What period are you referring to?",
  parentExcerpt: "for the 7-day window",
  options: ["7-day weekly window", "5-hour rolling window"],
  recommendedDefault: "7-day weekly window",
  confidence: 0.4,
};

test("parseParentDecisionBlocker extracts the fenced marker from surrounding prose", () => {
  const text = [
    "I considered the parent context but the period is unclear.",
    "<<<NEEDS_PARENT_DECISION",
    JSON.stringify(sample),
    "NEEDS_PARENT_DECISION>>>",
    "Awaiting a decision.",
  ].join("\n");
  const parsed = parseParentDecisionBlocker(text);
  assert.ok(parsed);
  assert.equal(parsed!.ambiguity, sample.ambiguity);
  assert.deepEqual(parsed!.options, sample.options);
  assert.equal(parsed!.confidence, 0.4);
});

test("parseParentDecisionBlocker returns null when there is no marker", () => {
  assert.equal(parseParentDecisionBlocker("just a normal question for the operator"), null);
});

test("parseParentDecisionBlocker returns null on malformed json", () => {
  const text = "<<<NEEDS_PARENT_DECISION\n{not json}\nNEEDS_PARENT_DECISION>>>";
  assert.equal(parseParentDecisionBlocker(text), null);
});

test("serializeParentBlocker round-trips via readItemBlocker as a parent decision", () => {
  const stored = serializeParentBlocker(sample);
  assert.ok(stored.startsWith("NEEDS_PARENT_DECISION:"));
  const read = readItemBlocker(stored);
  assert.equal(read?.kind, "parent");
  assert.equal((read?.payload as ParentDecisionBlocker).recommendedDefault, "7-day weekly window");
});

test("serializeOperatorEscalation is read back as an operator decision with a question", () => {
  const stored = serializeOperatorEscalation(sample, "Which usage window should the traffic light track?");
  assert.ok(stored.startsWith("NEEDS_OPERATOR_DECISION:"));
  const read = readItemBlocker(stored);
  assert.equal(read?.kind, "operator");
  const payload = read?.payload as { question: string; options: string[] };
  assert.equal(payload.question, "Which usage window should the traffic light track?");
  assert.deepEqual(payload.options, sample.options);
});

test("readItemBlocker returns null for a plain failure blocker", () => {
  assert.equal(readItemBlocker("agent crashed: timeout"), null);
  assert.equal(readItemBlocker(null), null);
});
