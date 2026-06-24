import test from "node:test";
import assert from "node:assert/strict";
import {
  voiceMarker,
  voiceResultText,
  deliverVoiceResults,
  _resetVoiceResultState,
  type VoiceResultTask,
} from "./voice-result-loop";

test("voiceMarker only matches voice tasks with a sessionId", () => {
  assert.equal(voiceMarker({ _id: "a", status: "done", output: {} }), null);
  assert.equal(voiceMarker({ _id: "a", status: "done", output: { voice: {} } }), null);
  assert.deepEqual(voiceMarker({ _id: "a", status: "done", output: { voice: { sessionId: "s1", surface: "ios" } } }),
    { sessionId: "s1", surface: "ios" });
});

test("voiceResultText: summary for success, friendly line for failure, '' when empty", () => {
  assert.equal(voiceResultText({ _id: "a", status: "done", output: { summary: "It's 10:15 PM." } }), "It's 10:15 PM.");
  assert.match(voiceResultText({ _id: "a", status: "failed", output: {} }), /couldn't finish/i);
  assert.equal(voiceResultText({ _id: "a", status: "done", output: { summary: "   " } }), "");
  // strips markdown + collapses whitespace
  assert.equal(voiceResultText({ _id: "a", status: "review", output: { summary: "**Done**\n\nTwo  things" } }), "Done Two things");
});

function tasksFixture(): VoiceResultTask[] {
  return [
    { _id: "t1", status: "done", source: "voice", output: { voice: { sessionId: "s1" }, summary: "It is 10:15 PM." } },
    { _id: "t2", status: "backlog", source: "voice", output: { voice: { sessionId: "s2" } } }, // not terminal
    { _id: "t3", status: "review", source: "voice", output: { summary: "no voice marker" } },   // no sessionId
  ];
}

test("first pass seeds (no delivery), then delivers each new terminal task once", async () => {
  _resetVoiceResultState();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const deps = {
    listVoiceTasks: async () => tasksFixture(),
    synthesize: async (_t: string) => "/tmp/fake.m4a",
    readAudioBase64: (_p: string) => "QUJD", // base64("ABC")
    broadcast: (event: string, data: unknown) => { events.push({ event, data: data as Record<string, unknown> }); },
  };

  // Seed pass: t1 is terminal+voice → marked seen, nothing delivered.
  assert.equal(await deliverVoiceResults(deps), 0);
  assert.equal(events.length, 0);

  // t1 already seen → still nothing.
  assert.equal(await deliverVoiceResults(deps), 0);

  // A NEW finished voice task appears → delivered once with audio.
  const withNew = () => [...tasksFixture(), { _id: "t4", status: "done", source: "voice", output: { voice: { sessionId: "s4" }, summary: "Two tasks are in review." } }];
  const n = await deliverVoiceResults({ ...deps, listVoiceTasks: async () => withNew() });
  assert.equal(n, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "voice:result");
  assert.deepEqual(
    { sessionId: events[0].data.sessionId, taskId: events[0].data.taskId, text: events[0].data.text, audioBase64: events[0].data.audioBase64, ok: events[0].data.ok },
    { sessionId: "s4", taskId: "t4", text: "Two tasks are in review.", audioBase64: "QUJD", ok: true },
  );

  // Idempotent: same task isn't re-delivered.
  assert.equal(await deliverVoiceResults({ ...deps, listVoiceTasks: async () => withNew() }), 0);
});

test("failed voice task delivers a spoken failure note (ok=false), text reply if synth throws", async () => {
  _resetVoiceResultState();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const base = {
    synthesize: async () => { throw new Error("voice runtime down"); },
    broadcast: (event: string, data: unknown) => { events.push({ event, data: data as Record<string, unknown> }); },
  };
  await deliverVoiceResults({ ...base, listVoiceTasks: async () => [] }); // seed empty
  const n = await deliverVoiceResults({
    ...base,
    listVoiceTasks: async () => [{ _id: "f1", status: "failed", source: "voice", output: { voice: { sessionId: "s9" } } }],
  });
  assert.equal(n, 1);
  assert.equal(events[0].data.ok, false);
  assert.equal(events[0].data.audioBase64, ""); // synth threw → text-only
  assert.match(String(events[0].data.text), /couldn't finish/i);
});
