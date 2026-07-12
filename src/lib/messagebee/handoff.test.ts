import assert from "node:assert/strict";
import test from "node:test";

import { routeInbound } from "./handoff";
import type { InboundMessage } from "./contracts";

const msg = (text: string, handle = "+15551234567", attachments: string[] = []): InboundMessage => ({
  rowid: 1, handle, text, receivedAt: "2026-06-12T00:00:00Z", service: "iMessage", attachments,
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

test("a photo-only message (empty text, one image attachment) routes to Flash Lane instead of being dropped as empty", () => {
  const r = routeInbound(msg("", "+15551234567", ["/tmp/photo.jpg"]), { allowlisted: true, pendingInput: [] });
  assert.equal(r.kind, "flash_turn");
  if (r.kind === "flash_turn") {
    assert.deepEqual(r.imagePaths, ["/tmp/photo.jpg"]);
    assert.ok(r.text.length > 0, "a photo-only message still gets non-empty text for the model");
  }
});

test("a captioned photo message carries both the text and the image path", () => {
  const r = routeInbound(msg("check this out", "+15551234567", ["/tmp/pic.jpg"]), { allowlisted: true, pendingInput: [] });
  assert.equal(r.kind, "flash_turn");
  if (r.kind === "flash_turn") {
    assert.equal(r.text, "check this out");
    assert.deepEqual(r.imagePaths, ["/tmp/pic.jpg"]);
  }
});

test("a photo-only message from a non-allowlisted sender is still ignored (security gate applies regardless of attachments)", () => {
  const r = routeInbound(msg("", "+15551234567", ["/tmp/photo.jpg"]), { allowlisted: false, pendingInput: [] });
  assert.equal(r.kind, "ignore");
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
