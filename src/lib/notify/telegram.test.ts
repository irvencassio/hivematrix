import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCallbackData, stuckKeyboard, approvalKeyboard, inlineKeyboard,
  isAuthorizedUpdate, type TelegramConfig, type TelegramUpdate,
} from "./telegram";

const cfg: TelegramConfig = { botToken: "x", chatId: 100, allowedUserIds: [7, 8] };

test("parseCallbackData parses stuck/approval (ISO timestamps with colons) and rejects junk", () => {
  assert.deepEqual(parseCallbackData("stuck|t1|2026-06-12T00:00:00Z|retry"),
    { kind: "stuck", id: "t1", timestamp: "2026-06-12T00:00:00Z", decision: "retry" });
  assert.deepEqual(parseCallbackData("approval|t2|ts|approve"),
    { kind: "approval", id: "t2", timestamp: "ts", decision: "approve" });
  assert.equal(parseCallbackData("nope|x"), null);
  assert.equal(parseCallbackData("other|a|b|c"), null);
});

test("stuck/approval keyboards carry the right callback data", () => {
  const sk = stuckKeyboard("t1", "2026-06-12T00:00:00Z");
  assert.deepEqual(sk.inline_keyboard[0].map((b) => b.callback_data),
    ["stuck|t1|2026-06-12T00:00:00Z|retry", "stuck|t1|2026-06-12T00:00:00Z|skip", "stuck|t1|2026-06-12T00:00:00Z|abort"]);
  const ak = approvalKeyboard("t1", "ts");
  assert.deepEqual(ak.inline_keyboard[0].map((b) => b.callback_data), ["approval|t1|ts|approve", "approval|t1|ts|denied"]);
});

test("inlineKeyboard shapes rows correctly", () => {
  const k = inlineKeyboard([[{ text: "A", data: "a" }], [{ text: "B", data: "b" }]]);
  assert.equal(k.inline_keyboard.length, 2);
  assert.deepEqual(k.inline_keyboard[0][0], { text: "A", callback_data: "a" });
});

test("isAuthorizedUpdate enforces chat + user allowlist", () => {
  const cb = (from: number, chat: number): TelegramUpdate => ({
    update_id: 1, callback_query: { id: "c", data: "stuck:t:ts:retry", from: { id: from }, message: { message_id: 1, chat: { id: chat } } },
  });
  assert.equal(isAuthorizedUpdate(cfg, cb(7, 100)), true);   // allowed user + chat
  assert.equal(isAuthorizedUpdate(cfg, cb(9, 100)), false);  // wrong user
  assert.equal(isAuthorizedUpdate(cfg, cb(7, 999)), false);  // wrong chat
});
