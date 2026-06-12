import assert from "node:assert/strict";
import test from "node:test";

import { resolveNotifyTargets } from "./notify";

test("resolveNotifyTargets honors channels + owner addresses", () => {
  const t = resolveNotifyTargets(
    { channels: ["telegram", "imessage", "email"], ownerHandle: "+15551234567", ownerEmail: "me@x.com" },
    true,
  );
  assert.deepEqual(t, { telegram: true, imessage: "+15551234567", email: "me@x.com" });
});

test("telegram target false when not configured even if selected", () => {
  const t = resolveNotifyTargets({ channels: ["telegram"] }, false);
  assert.equal(t.telegram, false);
});

test("a channel selected without its address resolves to null/false", () => {
  const t = resolveNotifyTargets({ channels: ["imessage", "email"] }, true);
  assert.equal(t.imessage, null);
  assert.equal(t.email, null);
});

test("unselected channels are off", () => {
  const t = resolveNotifyTargets({ channels: ["imessage"], ownerHandle: "h", ownerEmail: "e@x.com" }, true);
  assert.equal(t.telegram, false);
  assert.equal(t.imessage, "h");
  assert.equal(t.email, null); // email not selected
});
