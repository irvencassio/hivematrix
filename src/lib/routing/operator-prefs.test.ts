import assert from "node:assert/strict";
import test from "node:test";

import { learnedRoute, applyPick, DEFAULT_PREF_THRESHOLD } from "./operator-prefs";

test("learnedRoute: adopts a model only after a stable streak of the same pick", () => {
  // Fewer than threshold → no preference yet.
  assert.equal(learnedRoute(["mixed"]), null);
  assert.equal(learnedRoute(["mixed", "mixed"]), null);
  // Threshold reached, all agree → adopt.
  assert.equal(learnedRoute(["mixed", "mixed", "mixed"]), "mixed");
  // A recent change of mind breaks the streak → no stable preference.
  assert.equal(learnedRoute(["mixed", "mixed", "cloud-only"]), null);
  // Only the LAST `threshold` matter — an old pick doesn't taint a fresh streak.
  assert.equal(learnedRoute(["local", "cloud-only", "cloud-only", "cloud-only"]), "cloud-only");
  assert.equal(learnedRoute(undefined), null);
});

test("learnedRoute honors a custom threshold", () => {
  assert.equal(learnedRoute(["mixed", "mixed"], 2), "mixed");
  assert.equal(learnedRoute(["mixed"], 2), null);
  assert.equal(DEFAULT_PREF_THRESHOLD, 3);
});

test("applyPick appends and caps recent picks (a change of mind wins over time)", () => {
  let recent: string[] = [];
  for (let i = 0; i < 8; i++) recent = applyPick(recent, i < 4 ? "local" : "mixed");
  // Capped to the most recent 6; the tail reflects the latest choices.
  assert.ok(recent.length <= 6);
  assert.equal(recent[recent.length - 1], "mixed");
  assert.equal(learnedRoute(recent), "mixed", "the recent streak of 'mixed' is the learned route");
});
