import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("voice sidecar spoken-turn labels read 'assistant:' not 'bee:'", () => {
  const talk = read("voice-sidecar/talk.py");
  const live = read("voice-sidecar/live.py");

  assert.match(talk, /print\(f"assistant: /);
  assert.doesNotMatch(talk, /print\(f"bee: /);

  assert.match(live, /print\(f"assistant: /);
  assert.doesNotMatch(live, /print\(f"bee: /);
});

test("console chat labels the assistant reply with the hexagon, never 'bee:'", () => {
  // The header push-to-talk "Talk" flow (which rendered an inline 'assistant:'
  // status line) was removed; the chat transcript labels assistant turns with
  // the 🌀 hexagon. The scope-wall guard is that no 'bee:' brand label appears.
  const console_ = read("src/daemon/console.ts");

  assert.doesNotMatch(console_, /bee: " \+ res\.reply/);
  assert.match(console_, /m\.role === 'assistant' \? '🌀'/);
});

test("user guide documents /lanes first, /bees only as a compatibility alias", () => {
  const guide = read("docs/USER-GUIDE.html");

  // Primary API is the lane-shaped route.
  assert.match(guide, /<code>GET \/lanes<\/code>/);
  assert.match(guide, /<code>POST \/lanes\/:kind\/autostart<\/code>/);

  // /bees survives only inside the compatibility-alias note.
  assert.match(guide, /compatibility aliases:[^<]*<code>GET \/bees<\/code>/);
});
