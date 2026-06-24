import test from "node:test";
import assert from "node:assert/strict";
import { classifyReply, looksLikeFullScript, decisionReply, reviewPrompt } from "./review";

test("empty reply approves (the 'ship it' tap)", () => {
  assert.deepEqual(classifyReply(""), { action: "approve" });
  assert.deepEqual(classifyReply("   "), { action: "approve" });
});

test("short affirmatives approve", () => {
  for (const s of ["approve", "Ship it", "publish", "lgtm", "looks good", "yes", "👍", "go"]) {
    assert.equal(classifyReply(s).action, "approve", s);
  }
});

test("short negatives cancel", () => {
  for (const s of ["cancel", "scrap", "no", "stop", "discard", "reject"]) {
    assert.equal(classifyReply(s).action, "cancel", s);
  }
});

test("a short instruction is regenerate-with-feedback", () => {
  assert.deepEqual(classifyReply("cut the third story"), { action: "regenerate", feedback: "cut the third story" });
  assert.deepEqual(classifyReply("make the intro punchier"), { action: "regenerate", feedback: "make the intro punchier" });
});

test("a long or multi-line reply is treated as an edited script", () => {
  const multiline = "Hey everyone, welcome back.\nToday's top story is the new model release.";
  assert.equal(classifyReply(multiline).action, "edit");
  assert.equal(classifyReply(multiline).script, multiline);
  const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");
  assert.equal(classifyReply(long).action, "edit");
});

test("looksLikeFullScript heuristic", () => {
  assert.equal(looksLikeFullScript("short note"), false);
  assert.equal(looksLikeFullScript("line one\nline two"), true);
  assert.equal(looksLikeFullScript(Array.from({ length: 40 }, () => "w").join(" ")), true);
});

test("decisionReply phrasing per action", () => {
  assert.match(decisionReply({ action: "approve" }, "Top AI News"), /Approved.*rendering and publishing "Top AI News"/);
  assert.match(decisionReply({ action: "edit" }, "Top AI News"), /edited script/);
  assert.match(decisionReply({ action: "regenerate", feedback: "shorter" }, "x"), /Reworking the script: shorter/);
  assert.match(decisionReply({ action: "cancel" }, "x"), /Cancelled.*Nothing was rendered/);
});

test("reviewPrompt shows the full script and explains the choices", () => {
  const script = "First story. ".repeat(15) + "And the sign-off.";
  const p = reviewPrompt(script);
  assert.match(p, /Review this AI-news video script/);
  assert.match(p, /approve.*edited script.*cancel/s);
  // The whole script is shown for review (not clipped at 280 chars).
  assert.ok(p.includes("And the sign-off."), "the full script is included, not a short clip");
  assert.ok(!p.includes("…"), "a normal-length script is not truncated");
});

test("reviewPrompt only truncates a pathologically long script", () => {
  const p = reviewPrompt("word ".repeat(2000)); // ~10k chars
  assert.ok(p.includes("…"), "an extreme script is capped");
});
