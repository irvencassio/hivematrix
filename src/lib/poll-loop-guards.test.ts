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
  "embeddings/indexer.ts",
  "youtube/poller.ts",
  "orchestrator/frontier-debt.ts",
  "notify/notify-loop.ts",
];

// The shared scaffolding is the single source of the .catch guarantee for every
// loop that delegates to it (see lanes/poll-loop.ts).
test("startPollLoop centralizes the tick .catch guarantee", () => {
  const src = readFileSync(join(here, "lanes/poll-loop.ts"), "utf8");
  assert.match(src, /\.catch\(/, "startPollLoop must .catch tick failures");
  assert.doesNotMatch(src, /void [A-Za-z0-9_]+\([^)]*\)\s*\.finally\(/, "no floating rejection in the shared loop");
});

for (const rel of LOOP_FILES) {
  test(`${rel} loop guards tick failures (own .catch or via startPollLoop)`, () => {
    const src = readFileSync(join(here, rel), "utf8");
    assert.doesNotMatch(
      src,
      /void [A-Za-z0-9_]+\([^)]*\)\s*\.finally\(/,
      "a hand-rolled tick chain must include a .catch before .finally",
    );
    // Either the loop manages its own .catch, or it delegates the lifecycle (and the
    // guarantee) to startPollLoop.
    assert.ok(
      /\.catch\(/.test(src) || /startPollLoop\(/.test(src),
      "the loop must log tick failures via its own .catch or by using startPollLoop",
    );
  });
}
