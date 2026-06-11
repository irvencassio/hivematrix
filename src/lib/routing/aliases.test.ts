import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "os";

import { resolveProject } from "./aliases";

test("resolveProject keeps legacy ops alias mapped to home", () => {
  assert.equal(resolveProject("ops"), homedir());
});
