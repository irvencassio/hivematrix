import assert from "node:assert/strict";
import test from "node:test";

import { toBoardTaskPayload, toBoardTaskUpdateFields } from "./board-payload";

test("toBoardTaskPayload keeps only small live-board fields", () => {
  const task = {
    _id: "task-1",
    logs: Array.from({ length: 8 }, (_, i) => ({ type: "text", content: `log ${i}` })),
    turns: [{ id: "turn-1", content: { text: "large structured payload" } }],
    title: "Task",
  };

  const lite = toBoardTaskPayload(task);

  assert.equal(lite.logs.length, 5);
  assert.equal(lite.logs[0].content, "log 3");
  assert.deepEqual(lite.turns, []);
});

test("toBoardTaskUpdateFields removes structured turns before merging into board state", () => {
  const fields = {
    status: "review",
    turns: [{ id: "turn-1", content: { text: "large structured payload" } }],
    logs: [{ type: "text", content: "latest" }],
  };

  const lite = toBoardTaskUpdateFields(fields);

  assert.equal(lite.status, "review");
  assert.deepEqual(lite.turns, []);
  assert.equal(lite.logs.length, 1);
});
