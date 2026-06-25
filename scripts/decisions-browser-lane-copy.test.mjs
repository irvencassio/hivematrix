import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const decisions = readFileSync(new URL("../DECISIONS.md", import.meta.url), "utf8");

test("decisions doc uses Browser Lane wording for browser capability decisions", () => {
  for (const phrase of [
    "Browser Lane",
    "Desktop Lane",
    "Message Lane",
    "Mail Lane",
    "Review Lane",
    "Memory Lane",
  ]) {
    assert.match(decisions, new RegExp(phrase));
  }

  assert.match(decisions, /\/browserbee\/health/);
  assert.match(decisions, /browserbee\.desktopFallback/);
  assert.match(decisions, /webbee_search\/browserbee_run\/desktopbee_action/);

  assert.doesNotMatch(decisions, /\bBrowserBee\b|\bWebBee\b|\bWeaver\b|Bee lanes|Bees view/);
});
