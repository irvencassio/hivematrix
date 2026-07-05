import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Every interval-driven background loop must log a rejected tick instead of
// letting it surface as an unhandledRejection every interval. The pattern is
// pinned at source level so a refactor that drops the .catch fails CI, not
// production: `void tick().finally(...)` with no .catch is forbidden.
const here = dirname(fileURLToPath(import.meta.url));

const LOOP_FILES = [
  "messagebee/poller.ts",
  "mailbee/poller.ts",
  "flash/heartbeat.ts",
  "voice/voice-result-loop.ts",
  "traderbee/poller.ts",
  "work-packages/flight-loop-scheduler.ts",
  "embeddings/indexer.ts",
  "youtube/poller.ts",
  "orchestrator/frontier-debt.ts",
  "notify/notify-loop.ts",
  "local-model/serving.ts",
];

for (const rel of LOOP_FILES) {
  test(`${rel} loop logs tick failures instead of floating them`, () => {
    const src = readFileSync(join(here, rel), "utf8");
    assert.doesNotMatch(
      src,
      /void [A-Za-z0-9_]+\([^)]*\)\s*\.finally\(/,
      "a tick chain must include a .catch before .finally",
    );
    assert.match(src, /\.catch\(/, "the loop must log tick failures via .catch");
  });
}
