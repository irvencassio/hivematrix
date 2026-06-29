import assert from "node:assert/strict";
import test from "node:test";

import { notify, resolveNotifyTargets, type NotifyDeps } from "./notify";

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

test("notify skips Mail and Message app senders when their lanes are disabled", async () => {
  const calls: string[] = [];
  const deps: NotifyDeps = {
    getTelegramConfig: () => null,
    readNotifyConfig: () => ({ channels: ["imessage", "email"], ownerHandle: "+15551234567", ownerEmail: "me@x.com" }),
    isMessageLaneEnabled: () => false,
    isMailLaneEnabled: () => false,
    sendTelegram: async () => { calls.push("telegram"); return true; },
    sendIMessage: async () => { calls.push("imessage"); return true; },
    sendMail: async () => { calls.push("email"); return true; },
  };

  const result = await notify("hello", {}, deps);

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { telegram: false, imessage: false, email: false, anySent: false });
});

test("notify sends through enabled Mail and Message lanes", async () => {
  const calls: string[] = [];
  const deps: NotifyDeps = {
    getTelegramConfig: () => null,
    readNotifyConfig: () => ({ channels: ["imessage", "email"], ownerHandle: "+15551234567", ownerEmail: "me@x.com" }),
    isMessageLaneEnabled: () => true,
    isMailLaneEnabled: () => true,
    sendTelegram: async () => { calls.push("telegram"); return true; },
    sendIMessage: async () => { calls.push("imessage"); return true; },
    sendMail: async () => { calls.push("email"); return true; },
  };

  const result = await notify("hello", {}, deps);

  assert.deepEqual(calls, ["imessage", "email"]);
  assert.deepEqual(result, { telegram: false, imessage: true, email: true, anySent: true });
});
