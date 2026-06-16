import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveVoiceTitle, buildVoiceTaskDescription, routeVoiceSession, parseVoiceSessionBody, type VoiceSession,
} from "./session";

const session = (turns: VoiceSession["turns"], over: Partial<VoiceSession> = {}): VoiceSession => ({
  sessionId: "s1", surface: "ios", startedAt: "2026-06-16T20:00:00Z", turns, ...over,
});

test("deriveVoiceTitle uses the first user utterance, clipped", () => {
  assert.equal(deriveVoiceTitle(session([{ role: "user", text: "what's on my calendar tomorrow?" }])),
    "Voice: what's on my calendar tomorrow?");
  assert.equal(deriveVoiceTitle(session([])), "Voice session");
  const long = "a ".repeat(80).trim();
  assert.ok(deriveVoiceTitle(session([{ role: "user", text: long }])).endsWith("…"));
});

test("buildVoiceTaskDescription renders the transcript with surface + handle", () => {
  const d = buildVoiceTaskDescription(session(
    [{ role: "user", text: "book a dentist appt" }, { role: "assistant", text: "when works?" }],
    { handle: "+14155551234", surface: "phone" },
  ));
  assert.match(d, /phone · \+14155551234/);
  assert.match(d, /User: book a dentist appt/);
  assert.match(d, /Assistant: when works\?/);
});

test("routeVoiceSession spawns a task for a substantive request", () => {
  const r = routeVoiceSession(session([{ role: "user", text: "summarize my unread email" }]));
  assert.equal(r.kind, "task");
  if (r.kind === "task") assert.match(r.title, /summarize my unread email/);
});

test("routeVoiceSession skips empty or trivial exchanges", () => {
  assert.equal(routeVoiceSession(session([])).kind, "none");
  assert.equal(routeVoiceSession(session([{ role: "user", text: "thanks" }])).kind, "none");
});

test("routeVoiceSession always spawns a task when the sidecar escalated", () => {
  const r = routeVoiceSession(session([{ role: "user", text: "hmm" }]), { escalated: true });
  assert.equal(r.kind, "task");
});

test("parseVoiceSessionBody validates + normalizes a sidecar payload", () => {
  const out = parseVoiceSessionBody({
    sessionId: "s9", surface: "phone", handle: "+1", escalated: true,
    turns: [
      { role: "user", text: "hi there" },
      { role: "bogus", text: "coerced to user" },
      { role: "assistant", text: "" },        // empty dropped
      "junk",                                  // non-object dropped
    ],
  }, () => "2026-06-16T20:00:00Z");
  assert.ok(!("error" in out));
  if (!("error" in out)) {
    assert.equal(out.escalated, true);
    assert.equal(out.session.surface, "phone");
    assert.equal(out.session.startedAt, "2026-06-16T20:00:00Z");
    assert.deepEqual(out.session.turns, [
      { role: "user", text: "hi there" },
      { role: "user", text: "coerced to user" },
    ]);
  }
});

test("parseVoiceSessionBody requires a sessionId and defaults surface to ios", () => {
  assert.deepEqual(parseVoiceSessionBody({ turns: [] }), { error: "sessionId is required" });
  const out = parseVoiceSessionBody({ sessionId: "s1" }, () => "T");
  assert.ok(!("error" in out) && out.session.surface === "ios");
});
