import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./poller.ts", import.meta.url), "utf8");

test("Message Lane poller suppresses ignored prompts for blocked senders", () => {
  assert.match(source, /\bisBlocked\b/, "poller imports or references blocked identity checks");
  assert.match(
    source,
    /if\s*\(\s*!isAllowed\(msg\.handle\)\s*&&\s*!isBlocked\(msg\.handle\)\s*\)\s*recordIgnoredSender\(msg\.handle,\s*msg\.text\)/,
    "blocked non-allowlisted senders must not be re-added to ignored prompts",
  );
});
