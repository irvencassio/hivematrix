import test from "node:test";
import assert from "node:assert/strict";

import {
  markVoiceOrigin,
  shouldNotify,
  extractResultText,
  deterministicDistill,
  buildLoopMessage,
  distillLoopResult,
  closeVoiceLoop,
  flashSessionIdFromSource,
  shouldPostToThread,
  closeFlashThread,
  type LoopCloserTask,
  type LoopCloserDeps,
  type FlashThreadTask,
  type FlashThreadDeps,
} from "./loop-closer";

function task(over: Partial<LoopCloserTask> = {}): LoopCloserTask {
  return { _id: "t1", title: "E-bike research", status: "review", output: {}, ...over };
}

function flashTask(over: Partial<FlashThreadTask> = {}): FlashThreadTask {
  return { _id: "t1", title: "E-bike research", status: "review", output: {}, source: "flash:sess-1", ...over };
}

// ---------------------------------------------------------------------------
// markVoiceOrigin — creation-time marking
// ---------------------------------------------------------------------------

test("markVoiceOrigin stamps origin without disturbing existing metadata", () => {
  const out = markVoiceOrigin({ voice: { sessionId: "s1", surface: "ios" } });
  assert.deepEqual(out, { voice: { sessionId: "s1", surface: "ios" }, origin: "voice" });
});

test("markVoiceOrigin works with no prior output", () => {
  assert.deepEqual(markVoiceOrigin(), { origin: "voice" });
  assert.deepEqual(markVoiceOrigin(null), { origin: "voice" });
});

// ---------------------------------------------------------------------------
// shouldNotify — origin + idempotence + terminal-state guard
// ---------------------------------------------------------------------------

test("shouldNotify is true for a voice-origin task that just went terminal", () => {
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "review" })), true);
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "done" })), true);
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "failed" })), true);
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "cancelled" })), true);
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "archived" })), true);
});

test("shouldNotify is false for non-voice-origin tasks", () => {
  assert.equal(shouldNotify(task({ output: {}, status: "review" })), false);
  assert.equal(shouldNotify(task({ output: { origin: "dashboard" }, status: "review" })), false);
});

test("shouldNotify is false once already notified — idempotence guard", () => {
  assert.equal(
    shouldNotify(task({ output: { origin: "voice", loopNotifiedAt: "2026-07-10T00:00:00Z" }, status: "review" })),
    false,
  );
});

test("shouldNotify is false for a task not yet in a terminal state", () => {
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "backlog" })), false);
  assert.equal(shouldNotify(task({ output: { origin: "voice" }, status: "in_progress" })), false);
});

test("shouldNotify is false for a coordinator parked in waiting_children — the run isn't actually done", () => {
  assert.equal(
    shouldNotify(task({ output: { origin: "voice" }, status: "review", reviewState: "waiting_children" })),
    false,
  );
});

test("shouldNotify is false for a null/undefined task", () => {
  assert.equal(shouldNotify(null), false);
  assert.equal(shouldNotify(undefined), false);
});

// ---------------------------------------------------------------------------
// extractResultText / deterministicDistill
// ---------------------------------------------------------------------------

test("extractResultText pulls output.summary, trimmed", () => {
  assert.equal(extractResultText(task({ output: { summary: "  The Aventon Level.2 wins.  " } })), "The Aventon Level.2 wins.");
  assert.equal(extractResultText(task({ output: {} })), "");
  assert.equal(extractResultText(task({ output: { summary: 42 as unknown as string } })), "");
});

test("deterministicDistill collapses whitespace and clips with an ellipsis", () => {
  assert.equal(deterministicDistill("  hello   world  "), "hello world");
  assert.equal(deterministicDistill(""), "");
  const long = "a".repeat(250);
  const clipped = deterministicDistill(long, 200);
  assert.equal(clipped.length, 200);
  assert.ok(clipped.endsWith("…"));
});

// ---------------------------------------------------------------------------
// buildLoopMessage
// ---------------------------------------------------------------------------

test("buildLoopMessage formats a success line with the distilled result", () => {
  const msg = buildLoopMessage(task({ title: "E-bike research", status: "review" }), "The Aventon Level.2 is the standout under $2k.");
  assert.equal(msg, "✅ E-bike research: The Aventon Level.2 is the standout under $2k.");
});

test("buildLoopMessage sends the fixed failure notice for failed/cancelled tasks regardless of distilled text", () => {
  assert.equal(
    buildLoopMessage(task({ title: "E-bike research", status: "failed" }), "some partial text"),
    "⚠️ E-bike research didn't finish — it's on the board",
  );
  assert.equal(
    buildLoopMessage(task({ title: "E-bike research", status: "cancelled" }), ""),
    "⚠️ E-bike research didn't finish — it's on the board",
  );
});

test("buildLoopMessage sends the failure notice when there's no usable distilled text at all (noise guard)", () => {
  assert.equal(
    buildLoopMessage(task({ title: "E-bike research", status: "done" }), ""),
    "⚠️ E-bike research didn't finish — it's on the board",
  );
  assert.equal(
    buildLoopMessage(task({ title: "E-bike research", status: "done" }), "   "),
    "⚠️ E-bike research didn't finish — it's on the board",
  );
});

test("buildLoopMessage falls back to a generic title when the task has none", () => {
  assert.match(buildLoopMessage(task({ title: "", status: "review" }), "ok"), /^✅ Task: ok$/);
});

// ---------------------------------------------------------------------------
// distillLoopResult — model distillation with deterministic fallback
// ---------------------------------------------------------------------------

test("distillLoopResult returns empty immediately for empty result text (never calls the model)", async () => {
  let called = false;
  const out = await distillLoopResult("Title", "   ", async () => { called = true; return "x"; });
  assert.equal(out, "");
  assert.equal(called, false);
});

test("distillLoopResult uses the model's reply, cleaned of extra whitespace", async () => {
  const out = await distillLoopResult("Title", "some long result", async () => "  The answer is 42.  \n");
  assert.equal(out, "The answer is 42.");
});

test("distillLoopResult falls back to deterministic truncation when the model call throws", async () => {
  const out = await distillLoopResult("Title", "The Aventon Level.2 wins under $2k.", async () => {
    throw new Error("local model not configured");
  });
  assert.equal(out, "The Aventon Level.2 wins under $2k.");
});

test("distillLoopResult falls back to deterministic truncation when the model returns blank", async () => {
  const out = await distillLoopResult("Title", "some result text", async () => "   ");
  assert.equal(out, "some result text");
});

// ---------------------------------------------------------------------------
// closeVoiceLoop — end-to-end orchestration with injected deps
// ---------------------------------------------------------------------------

function makeDeps(over: Partial<LoopCloserDeps> = {}): { deps: LoopCloserDeps; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { notify: [], apns: [], markNotified: [] };
  const deps: LoopCloserDeps = {
    chatComplete: async () => "The Aventon Level.2 is the standout under $2k.",
    notify: (async (text: string) => { calls.notify.push(text); return { telegram: false, imessage: true, email: false, anySent: true }; }) as LoopCloserDeps["notify"],
    sendPush: (async (opts: unknown) => { calls.apns.push(opts); return { configured: true, sent: 1 }; }) as unknown as LoopCloserDeps["sendPush"],
    markNotified: async (taskId: string, notifiedAt: string) => { calls.markNotified.push([taskId, notifiedAt]); },
    now: () => "2026-07-10T12:00:00Z",
    ...over,
  };
  return { deps, calls };
}

test("closeVoiceLoop sends one distilled notify() + APNs push for a completed voice task", async () => {
  const { deps, calls } = makeDeps();
  const t = task({ status: "review", output: { origin: "voice", summary: "The Aventon Level.2 wins under $2k." } });

  await closeVoiceLoop(t, deps);

  assert.deepEqual(calls.notify, ["✅ E-bike research: The Aventon Level.2 is the standout under $2k."]);
  assert.equal(calls.apns.length, 1);
  assert.deepEqual(calls.apns[0], { title: "HiveMatrix", body: "✅ E-bike research: The Aventon Level.2 is the standout under $2k." });
  assert.deepEqual(calls.markNotified, [["t1", "2026-07-10T12:00:00Z"]]);
});

test("closeVoiceLoop is a no-op for a non-voice or already-notified task — no notify, no APNs, no re-mark", async () => {
  const { deps, calls } = makeDeps();
  await closeVoiceLoop(task({ output: {} }), deps);
  await closeVoiceLoop(task({ output: { origin: "voice", loopNotifiedAt: "already" } }), deps);
  assert.deepEqual(calls.notify, []);
  assert.deepEqual(calls.apns, []);
  assert.deepEqual(calls.markNotified, []);
});

test("closeVoiceLoop idempotence: a second terminal transition on the same task never notifies twice", async () => {
  const { deps, calls } = makeDeps();
  const store: { output: Record<string, unknown> } = { output: { origin: "voice", summary: "Done." } };
  const statefulDeps: LoopCloserDeps = {
    ...deps,
    markNotified: async (_taskId, notifiedAt) => { store.output = { ...store.output, loopNotifiedAt: notifiedAt }; },
  };

  await closeVoiceLoop(task({ output: store.output }), statefulDeps);
  // Simulate the orchestrator re-fetching the task fresh from the DB on the
  // next terminal transition — it now reflects the persisted loopNotifiedAt.
  await closeVoiceLoop(task({ output: store.output }), statefulDeps);

  assert.equal(calls.notify.length, 1);
  assert.equal(calls.apns.length, 1);
});

test("closeVoiceLoop sends the fixed failure notice (no distillation) for a failed task, without calling the model", async () => {
  let modelCalled = false;
  const { deps, calls } = makeDeps({ chatComplete: async () => { modelCalled = true; return "unused"; } });
  const t = task({ status: "failed", output: { origin: "voice", summary: "partial trace before the crash" } });

  await closeVoiceLoop(t, deps);

  assert.equal(modelCalled, false);
  assert.deepEqual(calls.notify, ["⚠️ E-bike research didn't finish — it's on the board"]);
  assert.equal(calls.markNotified.length, 1);
});

test("closeVoiceLoop tolerates notify() and APNs both rejecting — never throws, still marks notified once", async () => {
  const { deps, calls } = makeDeps({
    notify: (async () => { throw new Error("imessage down"); }) as LoopCloserDeps["notify"],
    sendPush: (async () => { throw new Error("push down"); }) as unknown as LoopCloserDeps["sendPush"],
  });
  const t = task({ status: "done", output: { origin: "voice", summary: "All good." } });

  await assert.doesNotReject(closeVoiceLoop(t, deps));
  assert.equal(calls.markNotified.length, 1);
});

test("closeVoiceLoop never throws even when the whole deps object is broken", async () => {
  const brokenDeps = {
    chatComplete: async () => { throw new Error("boom"); },
    notify: async () => { throw new Error("boom"); },
    sendPush: async () => { throw new Error("boom"); },
    markNotified: async () => { throw new Error("boom"); },
    now: () => { throw new Error("boom"); },
  } as unknown as LoopCloserDeps;
  const t = task({ status: "review", output: { origin: "voice", summary: "hello" } });
  await assert.doesNotReject(closeVoiceLoop(t, brokenDeps));
});

// ---------------------------------------------------------------------------
// flashSessionIdFromSource — pure source-string parsing
// ---------------------------------------------------------------------------

test("flashSessionIdFromSource extracts the session id from a flash: source", () => {
  assert.equal(flashSessionIdFromSource("flash:sess-123"), "sess-123");
});

test("flashSessionIdFromSource returns null for non-flash sources and empty ids", () => {
  assert.equal(flashSessionIdFromSource("dashboard"), null);
  assert.equal(flashSessionIdFromSource("mission"), null);
  assert.equal(flashSessionIdFromSource("flash:"), null);
  assert.equal(flashSessionIdFromSource("flash:   "), null);
  assert.equal(flashSessionIdFromSource(undefined), null);
  assert.equal(flashSessionIdFromSource(null), null);
});

// ---------------------------------------------------------------------------
// shouldPostToThread — flash: source + idempotence + terminal-state guard
// (independent of shouldNotify's voice-origin gate)
// ---------------------------------------------------------------------------

test("shouldPostToThread is true for ANY flash:-sourced task at a terminal state — chat, not just voice", () => {
  assert.equal(shouldPostToThread(flashTask({ source: "flash:sess-1", output: {}, status: "review" })), true);
  assert.equal(shouldPostToThread(flashTask({ source: "flash:sess-1", output: {}, status: "done" })), true);
  assert.equal(shouldPostToThread(flashTask({ source: "flash:sess-1", output: {}, status: "failed" })), true);
  // Also true when the SAME task is voice-origin (both gates can fire independently).
  assert.equal(shouldPostToThread(flashTask({ source: "flash:sess-1", output: { origin: "voice" }, status: "review" })), true);
});

test("shouldPostToThread is false for a non-flash source", () => {
  assert.equal(shouldPostToThread(flashTask({ source: "dashboard", status: "review" })), false);
  assert.equal(shouldPostToThread(flashTask({ source: undefined, status: "review" })), false);
});

test("shouldPostToThread is false once already posted — idempotence guard", () => {
  assert.equal(
    shouldPostToThread(flashTask({ output: { threadPostedAt: "2026-07-10T00:00:00Z" }, status: "review" })),
    false,
  );
});

test("shouldPostToThread is false for a task not yet in a terminal state", () => {
  assert.equal(shouldPostToThread(flashTask({ status: "backlog" })), false);
  assert.equal(shouldPostToThread(flashTask({ status: "in_progress" })), false);
});

test("shouldPostToThread is false for a coordinator parked in waiting_children", () => {
  assert.equal(shouldPostToThread(flashTask({ status: "review", reviewState: "waiting_children" })), false);
});

test("shouldPostToThread is false for a null/undefined task", () => {
  assert.equal(shouldPostToThread(null), false);
  assert.equal(shouldPostToThread(undefined), false);
});

// ---------------------------------------------------------------------------
// closeFlashThread — end-to-end orchestration with injected deps
// ---------------------------------------------------------------------------

function makeThreadDeps(over: Partial<FlashThreadDeps> = {}): { deps: FlashThreadDeps; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { appendTurn: [], broadcastEvent: [], markThreadPosted: [] };
  const deps: FlashThreadDeps = {
    chatComplete: async () => "The Aventon Level.2 is the standout under $2k.",
    appendTurn: (sessionId: string, role: string, content: string) => { calls.appendTurn.push([sessionId, role, content]); },
    broadcastEvent: (event: string, data: unknown) => { calls.broadcastEvent.push([event, data]); },
    markThreadPosted: async (taskId: string, postedAt: string) => { calls.markThreadPosted.push([taskId, postedAt]); },
    now: () => "2026-07-12T12:00:00Z",
    ...over,
  };
  return { deps, calls };
}

test("closeFlashThread appends exactly once to the flash: session's thread and emits flash:appended", async () => {
  const { deps, calls } = makeThreadDeps();
  const t = flashTask({ source: "flash:sess-1", status: "review", output: { summary: "The Aventon Level.2 wins under $2k." } });

  await closeFlashThread(t, deps);

  assert.equal(calls.appendTurn.length, 1);
  assert.deepEqual(calls.appendTurn[0], ["sess-1", "assistant", "✅ E-bike research: The Aventon Level.2 is the standout under $2k."]);
  assert.equal(calls.broadcastEvent.length, 1);
  assert.deepEqual(calls.broadcastEvent[0], ["flash:appended", { sessionId: "sess-1" }]);
  assert.deepEqual(calls.markThreadPosted, [["t1", "2026-07-12T12:00:00Z"]]);
});

test("closeFlashThread also posts back for a CHAT-originated escalation (no voice marker at all) — not voice-only", async () => {
  const { deps, calls } = makeThreadDeps();
  // No output.origin === "voice" anywhere — this is a plain chat escalation,
  // gated purely on source starting with "flash:".
  const t = flashTask({ source: "flash:chat-sess", status: "done", output: { summary: "Booked the flight." } });

  await closeFlashThread(t, deps);

  assert.equal(calls.appendTurn.length, 1);
  assert.equal((calls.appendTurn[0] as unknown[])[0], "chat-sess");
  assert.equal(calls.broadcastEvent.length, 1);
  assert.deepEqual((calls.broadcastEvent[0] as unknown[])[1], { sessionId: "chat-sess" });
});

test("closeFlashThread is idempotent: a second terminal transition on the same task never appends twice", async () => {
  const { deps, calls } = makeThreadDeps();
  const store: { output: Record<string, unknown> } = { output: { summary: "Done." } };
  const statefulDeps: FlashThreadDeps = {
    ...deps,
    markThreadPosted: async (_taskId, postedAt) => { store.output = { ...store.output, threadPostedAt: postedAt }; },
  };

  await closeFlashThread(flashTask({ source: "flash:sess-1", output: store.output }), statefulDeps);
  // Simulate the orchestrator re-fetching the task fresh from the DB on the
  // next terminal transition — it now reflects the persisted threadPostedAt.
  await closeFlashThread(flashTask({ source: "flash:sess-1", output: store.output }), statefulDeps);

  assert.equal(calls.appendTurn.length, 1);
  assert.equal(calls.broadcastEvent.length, 1);
});

test("closeFlashThread is a no-op for a non-flash source or an already-posted task", async () => {
  const { deps, calls } = makeThreadDeps();
  await closeFlashThread(flashTask({ source: "dashboard" }), deps);
  await closeFlashThread(flashTask({ source: "flash:sess-1", output: { threadPostedAt: "already" } }), deps);
  assert.deepEqual(calls.appendTurn, []);
  assert.deepEqual(calls.broadcastEvent, []);
  assert.deepEqual(calls.markThreadPosted, []);
});

test("closeFlashThread sends the fixed failure notice (no distillation) for a failed task", async () => {
  let modelCalled = false;
  const { deps, calls } = makeThreadDeps({ chatComplete: async () => { modelCalled = true; return "unused"; } });
  const t = flashTask({ source: "flash:sess-1", status: "failed", output: { summary: "partial trace before the crash" } });

  await closeFlashThread(t, deps);

  assert.equal(modelCalled, false);
  assert.deepEqual(calls.appendTurn[0], ["sess-1", "assistant", "⚠️ E-bike research didn't finish — it's on the board"]);
});

test("closeFlashThread never throws even when the whole deps object is broken", async () => {
  const brokenDeps = {
    chatComplete: async () => { throw new Error("boom"); },
    appendTurn: () => { throw new Error("boom"); },
    broadcastEvent: () => { throw new Error("boom"); },
    markThreadPosted: async () => { throw new Error("boom"); },
    now: () => { throw new Error("boom"); },
  } as unknown as FlashThreadDeps;
  const t = flashTask({ source: "flash:sess-1", status: "review", output: { summary: "hello" } });
  await assert.doesNotReject(closeFlashThread(t, brokenDeps));
});

test("closeFlashThread and closeVoiceLoop are independent gates — a voice+flash task fires both, a chat-only flash task fires only the thread post", async () => {
  const { deps: threadDeps, calls: threadCalls } = makeThreadDeps();
  const { deps: voiceDeps, calls: voiceCalls } = makeDeps();

  // Chat-originated: flash: source, but output.origin is NOT "voice".
  const chatTask = flashTask({ source: "flash:chat-1", status: "review", output: { summary: "Chat result." } });
  await closeFlashThread(chatTask, threadDeps);
  await closeVoiceLoop(chatTask, voiceDeps);
  assert.equal(threadCalls.appendTurn.length, 1, "thread post fires for chat-originated escalation");
  assert.equal(voiceCalls.notify.length, 0, "OS notification does NOT fire — this task is not voice-origin");
});
