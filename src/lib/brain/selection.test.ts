import test from "node:test";
import assert from "node:assert/strict";

import { mergeBrainSelection, normalizeBrainSelection } from "./selection";

test("normalizeBrainSelection falls back to empty task/mission/session buckets", () => {
  assert.deepEqual(normalizeBrainSelection(null), {
    task: [],
    mission: [],
    session: [],
  });
});

test("mergeBrainSelection updates one scope without dropping the others", () => {
  const merged = mergeBrainSelection(
    {
      task: ["projects/hive/agent-brief.md"],
      mission: [],
      session: ["projects/hive/known-issues.md"],
    },
    {
      mission: ["projects/hive/lanes/memory.md"],
    },
  );

  assert.deepEqual(merged, {
    task: ["projects/hive/agent-brief.md"],
    mission: ["projects/hive/lanes/memory.md"],
    session: ["projects/hive/known-issues.md"],
  });
});
