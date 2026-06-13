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
