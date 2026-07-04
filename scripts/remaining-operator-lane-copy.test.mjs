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

test("console Talk status text labels the reply 'assistant:' not 'bee:'", () => {
  const console_ = read("src/daemon/console.ts");

  assert.match(console_, /" {2}· {2}assistant: " \+ res\.reply/);
  assert.doesNotMatch(console_, /" {2}· {2}bee: " \+ res\.reply/);
});

test("user guide documents /lanes first, /bees only as a compatibility alias", () => {
  const guide = read("docs/USER-GUIDE.html");

  // Primary API is the lane-shaped route.
  assert.match(guide, /<code>GET \/lanes<\/code>/);
  assert.match(guide, /<code>POST \/lanes\/:kind\/autostart<\/code>/);

  // /bees survives only inside the compatibility-alias note.
  assert.match(guide, /compatibility aliases:[^<]*<code>GET \/bees<\/code>/);
});
