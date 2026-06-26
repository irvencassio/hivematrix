import test from "node:test";
import assert from "node:assert/strict";

import { runSmoke } from "./release-smoke.mjs";

test("pre-release operator-path smoke checklist passes", async () => {
  const { ok, checks } = await runSmoke({ quiet: true });
  const failed = checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  assert.equal(ok, true, failed.length ? `failing checks:\n - ${failed.join("\n - ")}` : "all checks pass");
  // The checklist must cover the documented operator surfaces.
  const names = checks.map((c) => c.name).join("\n");
  assert.match(names, /lane-apps status returns Browser Lane \+ Terminal Lane/);
  assert.match(names, /leaks no secret values/);
  assert.match(names, /video approval routes through Browser Lane portal/);
  assert.match(names, /workflow inbox loads/);
});
