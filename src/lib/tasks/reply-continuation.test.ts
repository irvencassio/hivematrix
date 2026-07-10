import assert from "node:assert/strict";
import test from "node:test";

import { appendReplyContinuation, appendChildrenResultsContinuation } from "./reply-continuation";

test("appendReplyContinuation adds operator reply and attachments as rerun guidance", () => {
  const next = appendReplyContinuation("Original task", "Use the HiveMatrix project.\n\nAttached files:\n- /tmp/a.txt");

  assert.match(next, /Original task/);
  assert.match(next, /--- Operator reply \(continue\) ---/);
  assert.match(next, /Use the HiveMatrix project/);
  assert.match(next, /Attached files:\n- \/tmp\/a\.txt/);
});

test("appendReplyContinuation formats structured attachments with stable paths", () => {
  const next = appendReplyContinuation("Original task", "See the screenshot.", [
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);

  assert.match(next, /--- Operator reply \(continue\) ---/);
  assert.match(next, /See the screenshot\./);
  assert.match(next, /- shot\.png\n {2}path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(next, /Use the absolute path above/);
});

test("appendChildrenResultsContinuation carries the results block forward with an honest (non-operator) header", () => {
  const next = appendChildrenResultsContinuation("Original coordinator task", "## Results from delegated subtasks\n\n### [qa] Verify — archived\nAll good.");
  assert.match(next, /Original coordinator task/);
  assert.match(next, /--- Delegated subtask results \(continue\) ---/);
  assert.doesNotMatch(next, /Operator reply/, "must not mislabel child results as an operator reply");
  assert.match(next, /### \[qa\] Verify — archived/);
});
