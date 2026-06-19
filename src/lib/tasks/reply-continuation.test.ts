import assert from "node:assert/strict";
import test from "node:test";

import { appendReplyContinuation } from "./reply-continuation";

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
  assert.match(next, /- shot\.png\n  path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(next, /Use the absolute path above/);
});
