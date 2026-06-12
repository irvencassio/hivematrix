import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHandle, handlesMatch, parseModelDirective, deriveMessageTaskTitle } from "./contracts";

test("normalizeHandle lowercases emails and strips phone formatting", () => {
  assert.equal(normalizeHandle("  Foo@Example.com "), "foo@example.com");
  assert.equal(normalizeHandle("+1 (555) 123-4567"), "+15551234567");
  assert.equal(normalizeHandle("555.123.4567"), "5551234567");
});

test("handlesMatch compares emails exactly and phones by last-10", () => {
  assert.equal(handlesMatch("+1 555 123 4567", "(555) 123-4567"), true);
  assert.equal(handlesMatch("15551234567", "5551234567"), true);
  assert.equal(handlesMatch("a@b.com", "A@B.com"), true);
  assert.equal(handlesMatch("a@b.com", "+15551234567"), false);
  assert.equal(handlesMatch("5551234567", "5559999999"), false);
  assert.equal(handlesMatch("", "5551234567"), false);
});

test("parseModelDirective extracts /model and strips it", () => {
  assert.deepEqual(parseModelDirective("/model opus draft a reply"), { model: "opus", cleanedText: "draft a reply" });
  assert.deepEqual(parseModelDirective("summarize this #model sonnet now"), { model: "sonnet", cleanedText: "summarize this now" });
  assert.deepEqual(parseModelDirective("no directive here"), { model: null, cleanedText: "no directive here" });
});

test("deriveMessageTaskTitle uses the first line, clamped, prefixed", () => {
  assert.equal(deriveMessageTaskTitle("check the inbox\nand reply"), "SMS: check the inbox");
  assert.match(deriveMessageTaskTitle("x".repeat(120)), /^SMS: x{69}…$/);
});
