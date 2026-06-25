import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./desktopbee-proof.mts", import.meta.url), "utf8");

test("desktop proof script uses lane names in operator-facing copy", () => {
  assert.match(source, /Desktop Lane Phase 4 Proof/);
  assert.match(source, /HiveMatrix Desktop Lane proof/);
  assert.doesNotMatch(source, /DesktopBee Phase 4 Proof/);
  assert.doesNotMatch(source, /HiveMatrix DesktopBee proof/);
  assert.doesNotMatch(source, /Requires: DesktopBee helper/);
});
