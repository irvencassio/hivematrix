import test from "node:test";
import assert from "node:assert";
import { isInternalStatusOnly, stripInternalStatus } from "./status-filter";

test("status-filter: recognizes pure status strings", () => {
  assert.equal(isInternalStatusOnly("Task created."), true);
  assert.equal(isInternalStatusOnly("Check back in a moment."), true);
  assert.equal(isInternalStatusOnly("Task queued"), true);
  assert.equal(isInternalStatusOnly("Processing..."), true);
});

test("status-filter: recognizes multi-line pure status", () => {
  assert.equal(
    isInternalStatusOnly("Task created.\nWaiting for completion."),
    true
  );
  assert.equal(
    isInternalStatusOnly("Check back in a moment.\nProcessing..."),
    true
  );
});

test("status-filter: allows user content mixed with status", () => {
  assert.equal(isInternalStatusOnly("Hello, your order is ready!"), false);
  assert.equal(isInternalStatusOnly("Call me back:\nTask created."), false);
});

test("status-filter: strips status lines preserving content", () => {
  const input = "Hello there\nTask created.\nHow are you?";
  const output = stripInternalStatus(input);
  assert.equal(output, "Hello there\nHow are you?");
});

test("status-filter: preserves intentional formatting", () => {
  const input = "Line 1\nLine 2\n\nLine 3";
  const output = stripInternalStatus(input);
  assert.equal(output, input);
});

test("status-filter: removes leading/trailing blank lines", () => {
  const input = "\n\nHello\n\n";
  const output = stripInternalStatus(input);
  assert.equal(output, "Hello");
});

test("status-filter: handles empty strings", () => {
  assert.equal(isInternalStatusOnly(""), false);
  assert.equal(stripInternalStatus(""), "");
});
