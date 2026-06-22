import test from "node:test";
import assert from "node:assert/strict";
import { StreamParser } from "./stream-parser";

test("system/init emits a session event (so steering works mid-run) + init", () => {
  const p = new StreamParser();
  const events = p.parseLine(JSON.stringify({
    type: "system", subtype: "init", session_id: "sess-abc123", model: "claude-sonnet-4-6",
  }));
  assert.deepEqual(events, [
    { type: "session", sessionId: "sess-abc123" },
    { type: "init", model: "claude-sonnet-4-6" },
  ]);
});

test("system/init without a session_id still emits init only", () => {
  const p = new StreamParser();
  const events = p.parseLine(JSON.stringify({ type: "system", subtype: "init", model: "x" }));
  assert.deepEqual(events, [{ type: "init", model: "x" }]);
});

test("result message still carries the session id", () => {
  const p = new StreamParser();
  const [ev] = p.parseLine(JSON.stringify({
    type: "result", subtype: "success", session_id: "sess-abc123", result: "done", num_turns: 2,
  }));
  assert.equal(ev.type, "result");
  assert.equal((ev as { sessionId: string }).sessionId, "sess-abc123");
});
