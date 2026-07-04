import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Every interval-driven poll loop must log a rejected tick instead of letting
// it surface as an unhandledRejection. The pattern is pinned at source level
// so a refactor that drops the .catch fails CI, not production.
const here = dirname(fileURLToPath(import.meta.url));

for (const rel of ["messagebee/poller.ts", "mailbee/poller.ts"]) {
  test(`${rel} poll loop logs tick failures instead of floating them`, () => {
    const src = readFileSync(join(here, rel), "utf8");
    assert.doesNotMatch(src, /void pollOnce\(\)\.finally/, "pollOnce chain must include a .catch before .finally");
    assert.match(src, /void pollOnce\(\)\s*\n?\s*\.catch\(/, "pollOnce chain must log failures via .catch");
  });
}
