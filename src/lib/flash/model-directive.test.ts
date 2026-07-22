import test from "node:test";
import assert from "node:assert/strict";

import { parseModelDirective, effectiveModelOverride } from "./model-directive";

test("pins a conversation to a named model", () => {
  for (const name of ["opus", "sonnet", "haiku"]) {
    const d = parseModelDirective(`/model ${name}`);
    assert.equal(d.model, name);
    assert.equal(d.text, "", "the directive alone leaves no message to send");
    assert.match(d.notice ?? "", new RegExp(name));
  }
});

test("a directive followed by a message keeps the message", () => {
  const d = parseModelDirective("/model opus\nnow summarise the release notes");
  assert.equal(d.model, "opus");
  assert.equal(d.text, "now summarise the release notes", "the turn still runs, on the new model");
});

test("clears the override and returns to the default", () => {
  for (const word of ["default", "reset", "clear", "auto", "none"]) {
    const d = parseModelDirective(`/model ${word}`);
    assert.equal(d.model, "", "empty string means clear, distinct from null (not a directive)");
    assert.match(d.notice ?? "", /cleared/i);
  }
});

test("an ordinary message that merely MENTIONS a model is never a directive", () => {
  // The whole reason this is an explicit command rather than natural-language
  // detection: discussing a model must not silently repoint the conversation.
  for (const msg of [
    "why did that task run on sonnet?",
    "switch to opus please",
    "I want everything in opus",
    "the model is haiku right now",
    "run this in a different model",
  ]) {
    const d = parseModelDirective(msg);
    assert.equal(d.model, null, `"${msg}" must not be treated as a directive`);
    assert.equal(d.text, msg, "the message passes through untouched");
    assert.equal(d.notice, null);
  }
});

test("a directive is only recognised at the START of a message", () => {
  const d = parseModelDirective("please do this then /model opus");
  assert.equal(d.model, null, "a trailing directive is just text");
});

test("full provider ids pass through, unknown names are refused with guidance", () => {
  assert.equal(parseModelDirective("/model claude-opus-4-8").model, "claude-opus-4-8");
  assert.equal(parseModelDirective("/model codex:gpt-5.5").model, "codex:gpt-5.5");

  const bad = parseModelDirective("/model gpt4-turbo-ultra");
  assert.equal(bad.model, null, "an unrecognised name must not be pinned blindly");
  assert.match(bad.notice ?? "", /Unknown model/);

  const bare = parseModelDirective("/model");
  assert.equal(bare.model, null);
  assert.match(bare.notice ?? "", /Usage:/);
});

test("effectiveModelOverride treats blank and missing as no override", () => {
  assert.equal(effectiveModelOverride("opus"), "opus");
  assert.equal(effectiveModelOverride(""), null);
  assert.equal(effectiveModelOverride("   "), null);
  assert.equal(effectiveModelOverride(null), null);
  assert.equal(effectiveModelOverride(undefined), null);
});
