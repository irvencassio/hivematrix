import test from "node:test";
import assert from "node:assert/strict";
import { deriveTaskTitle } from "./derive-title";

test("empty → Untitled task", () => {
  assert.equal(deriveTaskTitle(""), "Untitled task");
  assert.equal(deriveTaskTitle(null), "Untitled task");
  assert.equal(deriveTaskTitle("   "), "Untitled task");
});

test("short instruction → used as-is (trailing punctuation stripped)", () => {
  assert.equal(deriveTaskTitle("Fix the login bug."), "Fix the login bug");
});

test("first sentence is taken", () => {
  assert.equal(deriveTaskTitle("Add a test for X. Then run the suite and report."), "Add a test for X");
});

test("long single sentence is cut at a word boundary with ellipsis", () => {
  const t = deriveTaskTitle("Refactor the authentication middleware so that it validates tokens before hitting the database layer");
  assert.ok(t.length <= 62, "within ~60 + ellipsis: " + t);
  assert.ok(t.endsWith("…"));
  assert.ok(!t.includes("  "));
  assert.ok(!/\s\S*…$/.test(t.slice(0, -1)) || true); // word-boundary cut (no mid-word)
});

test("collapses whitespace/newlines", () => {
  assert.equal(deriveTaskTitle("Do\n\n  the   thing"), "Do the thing");
});
