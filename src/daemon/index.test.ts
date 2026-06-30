import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("daemon startup does not start the Morning Briefing loop", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(
    !src.includes("startMorningBriefingLoop"),
    "startMorningBriefingLoop must not be imported or called in daemon/index.ts",
  );
});
