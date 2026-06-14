import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexPrompt } from "./codex-agent";

test("buildCodexPrompt prepends the outbound routing block and keeps the task", () => {
  const prompt = buildCodexPrompt("Email Jane the Q3 numbers.");
  // routing guidance present
  assert.match(prompt, /\/mailbee\/send/);
  assert.match(prompt, /\/messagebee\/send/);
  assert.match(prompt, /do NOT use osascript/i);
  // the actual task is preserved, after the delimiter
  assert.match(prompt, /--- Your task ---\nEmail Jane the Q3 numbers\./);
  // task comes after the guidance, not before
  assert.ok(prompt.indexOf("/mailbee/send") < prompt.indexOf("Email Jane"));
});
