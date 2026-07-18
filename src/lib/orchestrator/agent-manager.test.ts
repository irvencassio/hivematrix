import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { detectTransientFailureText, shouldRaiseSilenceWatchdog, shouldAutoArchiveSubtask, shouldEnterWaitingChildren, MAX_DELEGATION_CONTINUATIONS } from "./agent-manager";

test("detectTransientFailureText treats Claude updater lock as retryable", () => {
  const text = [
    "Error: Another instance is currently performing an update",
    "Please wait and try again later",
    "Bun v1.3.14 (macOS arm64)",
  ].join("\n");

  assert.deepEqual(detectTransientFailureText(text), {
    transient: true,
    delayMinutes: 2,
    reason: "Claude CLI update in progress",
  });
});

test("shouldRaiseSilenceWatchdog covers mission and dashboard tasks", () => {
  assert.equal(shouldRaiseSilenceWatchdog({ missionId: "mission-1", source: "dispatch" }), true);
  assert.equal(shouldRaiseSilenceWatchdog({ missionId: null, source: "dashboard" }), true);
  assert.equal(shouldRaiseSilenceWatchdog({ missionId: null, source: "dispatch" }), false);
  assert.equal(shouldRaiseSilenceWatchdog(null), false);
});

test("shouldAutoArchiveSubtask: a subtask that finished cleanly auto-archives; one that needs input still surfaces", () => {
  assert.equal(shouldAutoArchiveSubtask(true, "ready_for_review"), true);
  assert.equal(shouldAutoArchiveSubtask(true, null), true);
  assert.equal(shouldAutoArchiveSubtask(true, "needs_input"), false, "a stuck subtask has no parent-resolves-child mechanism — it still surfaces to the operator");
});

test("shouldAutoArchiveSubtask: a top-level task (no parent) is never auto-archived — that would skip human review entirely", () => {
  assert.equal(shouldAutoArchiveSubtask(false, "ready_for_review"), false);
  assert.equal(shouldAutoArchiveSubtask(false, null), false);
});

test("shouldEnterWaitingChildren: a coordinator with fresh children and no prior continuation waits", () => {
  assert.equal(shouldEnterWaitingChildren({ isSubtask: false, priorContinuations: 0, childrenCount: 2 }), true);
});

test("shouldEnterWaitingChildren: no children ⇒ ordinary completion, never waits", () => {
  assert.equal(shouldEnterWaitingChildren({ isSubtask: false, priorContinuations: 0, childrenCount: 0 }), false);
});

test("shouldEnterWaitingChildren: a parent that already used its one continuation never waits again — the anti-runaway guard", () => {
  assert.equal(shouldEnterWaitingChildren({ isSubtask: false, priorContinuations: MAX_DELEGATION_CONTINUATIONS, childrenCount: 3 }), false);
});

test("shouldEnterWaitingChildren: a subtask never waits — depth cap 2 means it can't have children anyway, but this is defensive", () => {
  assert.equal(shouldEnterWaitingChildren({ isSubtask: true, priorContinuations: 0, childrenCount: 1 }), false);
});

test("agent text output emits a push event so the console does not wait for its 5s poll", () => {
  // Root cause this guards: setBroadcaster() is defined on AgentManager but is
  // never called by anything, so every per-delta this.broadcaster(...) call is a
  // no-op. That left the live transcript with NO push path — the console only
  // learned about agent output via its 5s backstop poll, which is why generation
  // appeared to arrive in 5-second chunks no matter how fast the model streamed.
  // flushTextBuffer must therefore broadcast, and must do it on the (already
  // 500ms-debounced) FLUSH rather than per token, since the console's handler
  // re-polls and a per-token emit would be a refresh storm.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "agent-manager.ts"), "utf8");
  const start = src.indexOf("private async flushTextBuffer");
  const end = src.indexOf("private async handleEvent");
  assert.ok(start !== -1 && end > start, "flushTextBuffer should be locatable");
  const flush = src.slice(start, end);
  assert.match(flush, /broadcastEvent\("tasks:updated"/, "flush must push a live-output event");
  assert.match(src, /import \{ broadcastEvent \} from "@\/lib\/ws\/broadcaster"/);
  // The emit must be failure-isolated: a broadcast problem cannot break the run.
  assert.match(flush, /catch\s*\{/, "broadcast must be wrapped so it can never break the run");
});
