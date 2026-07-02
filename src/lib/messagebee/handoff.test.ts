import assert from "node:assert/strict";
import test from "node:test";

import { routeInbound } from "./handoff";
import type { InboundMessage } from "./contracts";

const msg = (text: string, handle = "+15551234567"): InboundMessage => ({
  rowid: 1, handle, text, receivedAt: "2026-06-12T00:00:00Z", service: "iMessage",
});

test("non-allowlisted sender is ignored (read-only security gate)", () => {
  const r = routeInbound(msg("do something"), { allowlisted: false, pendingInput: [] });
  assert.equal(r.kind, "ignore");
});

test("empty message is ignored", () => {
  const r = routeInbound(msg("   "), { allowlisted: true, pendingInput: [] });
  assert.equal(r.kind, "ignore");
});

test("allowlisted sender with no pending input routes to Flash Lane", () => {
  const r = routeInbound(msg("draft the newsletter"), { allowlisted: true, pendingInput: [] });
  assert.equal(r.kind, "flash_turn");
  if (r.kind === "flash_turn") {
    assert.equal(r.text, "draft the newsletter");
    assert.equal(r.peer, "+15551234567");
  }
});

test("flash_turn strips an inline /model directive from the text", () => {
  const r = routeInbound(msg("/model opus ship the fix"), { allowlisted: true, pendingInput: [] });
  assert.equal(r.kind, "flash_turn");
  if (r.kind === "flash_turn") { assert.equal(r.text, "ship the fix"); }
});

test("text resolves the most-recent pending input task", () => {
  const r = routeInbound(msg("yes, approved"), {
    allowlisted: true,
    pendingInput: [
      { taskId: "t1", stuckTimestamp: "2026-06-12T00:00:00Z" },
      { taskId: "t2", stuckTimestamp: "2026-06-12T01:00:00Z" },
    ],
  });
  assert.equal(r.kind, "reply_to_task");
  if (r.kind === "reply_to_task") { assert.equal(r.taskId, "t2"); assert.equal(r.text, "yes, approved"); }
});
