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

test("FlashDispatch accepts an optional imagePaths third argument", () => {
  assert.match(
    source,
    /type FlashDispatch = \(text: string, peer: string, imagePaths\?: string\[\]\) => Promise<string>/,
    "the injected dispatch callback must be able to carry image paths through to Flash",
  );
});

test("handleInbound threads the inbound message's attachments into routeInbound", () => {
  assert.match(
    source,
    /routeInbound\(\s*\{[\s\S]*?attachments:\s*msg\.attachments/,
    "attachments must reach routeInbound so a photo-only message isn't dropped as empty",
  );
});

test("a photo-only route is dispatched to Flash with its image paths, not dropped", () => {
  assert.match(
    source,
    /flashDispatch\(text,\s*route\.peer,\s*route\.imagePaths\.length \? route\.imagePaths : undefined\)/,
    "flash_turn routing must forward route.imagePaths to the dispatch callback",
  );
});
