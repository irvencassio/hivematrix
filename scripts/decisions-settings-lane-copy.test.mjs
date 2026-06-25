import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const decisions = readFileSync(new URL("../DECISIONS.md", import.meta.url), "utf8");

test("DECISIONS settings and scenario prose use lane naming", () => {
  assert.match(decisions, /channel lanes \+ Directives/);
  assert.match(decisions, /new capability-lane proposal/);
  assert.match(decisions, /Settings tabs are now \*\*Models \| Remote \| General \| Projects \| Lanes\*\*/);
  assert.match(decisions, /Settings tab order\*\* defined: \*\*Models · Lanes · Projects · General · Remote · About\*\*/);

  assert.doesNotMatch(decisions, /channel Bees|new Bee brand/);
  assert.doesNotMatch(decisions, /Settings tabs are now \*\*Models \| Remote \| General \| Projects \| Bees\*\*/);
  assert.doesNotMatch(decisions, /Settings tab order\*\* defined: \*\*Models · Bees · Projects · General · Remote · About\*\*/);
});
