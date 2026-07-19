import test from "node:test";
import assert from "node:assert/strict";

const { CURRENT_VERSION } = await import("./daemon-update");

test("CURRENT_VERSION: exists and is non-empty", () => {
  assert.ok(CURRENT_VERSION);
  assert.match(CURRENT_VERSION, /^\d+\.\d+\.\d+/);
});
