/**
 * Voice Loop-Closer — a task that originated from voice (the /voice/session
 * escalation route, or the flash loop's `escalate_to_task` tool when the
 * flash channel is "voice") must deliver its outcome BACK to the operator,
 * unprompted, once it reaches a terminal state. Otherwise the answer dies on
 * the task board while the operator is left wondering what happened.
 *
 * Origin + idempotence ride the existing `tasks.output` JSON column (no new
 * persistent store — see DECISIONS.md-free scope-wall: `output` already
 * carries free-form per-task metadata, e.g. `output.voice` for the sidecar
 * handoff). Two keys live there:
 *   - `output.origin === "voice"`   — set at task-creation time on both paths
 *   - `output.loopNotifiedAt`       — set here, once, before any send is
 *                                     attempted, so a slow/failing send can
 *                                     never cause a duplicate notification.
 *
 * This module is deliberately pure where possible (`shouldNotify`,
 * `extractResultText`, `deterministicDistill`, `buildLoopMessage`) and takes
 * an injectable `LoopCloserDeps` for the impure edges (model call, notify,
 * APNs, persistence) — same shape as `NotifyDeps` in lib/notify/notify.ts.
 *
 * `closeVoiceLoop` is the single entry point the task runner calls at its
 * one terminal-transition hook (src/lib/orchestrator/agent-manager.ts,
 * `handleExit`). It NEVER throws — every failure is caught and logged as a
 * one-line notice, because a notification hiccup must never take down the
 * task runner.
 */

import { notify as defaultNotify } from "@/lib/notify/notify";
import { sendApnsPush as defaultSendApnsPush } from "@/lib/notify/apns";
import { localChatComplete, type ChatComplete } from "@/lib/models/chat-client";
import { Task } from "@/lib/db";

export const VOICE_ORIGIN = "voice";

/** The subset of a Task the loop-closer needs to reason about. */
export interface LoopCloserTask {
  _id: string;
  title: string;
  status: string;
  reviewState?: string | null;
  output?: Record<string, unknown> | null;
}

// Statuses `handleExit` can leave a run in when it truly stops (as opposed to
// requeue-to-backlog paths like transient retry / local-model fallback, which
// return early and never reach the loop-closer hook).
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["review", "done", "failed", "cancelled", "archived"]);
const FAILURE_STATUSES: ReadonlySet<string> = new Set(["failed", "cancelled"]);

const MAX_FALLBACK_CHARS = 200;
const DISTILL_MAX_TOKENS = 120;

// ---------------------------------------------------------------------------
// Origin marking (creation-time)
// ---------------------------------------------------------------------------

/** Pure: stamp `origin: "voice"` onto a task's `output` metadata without
 * disturbing whatever else already lives there (e.g. `output.voice`). */
export function markVoiceOrigin(output?: Record<string, unknown> | null): Record<string, unknown> {
  return { ...(output ?? {}), origin: VOICE_ORIGIN };
}

// ---------------------------------------------------------------------------
// Pure decision + message-building pieces
// ---------------------------------------------------------------------------

/**
 * True when `task` is a voice-origin task that just reached a terminal state
 * and has not already been notified. This is the idempotence + scope guard:
 * false for anything not marked `origin:"voice"`, anything already notified,
 * anything not yet terminal, and a coordinator parked in `waiting_children`
 * (its run continues once subtasks settle — it is not actually done).
 */
export function shouldNotify(task: LoopCloserTask | null | undefined): boolean {
  if (!task) return false;
  const output = task.output ?? {};
  if (output.origin !== VOICE_ORIGIN) return false;
  if (output.loopNotifiedAt) return false;
  if (!TERMINAL_STATUSES.has(task.status)) return false;
  if (task.reviewState === "waiting_children") return false;
  return true;
}

/** Pure: the best available result text for a finished task. */
export function extractResultText(task: LoopCloserTask): string {
  const output = task.output ?? {};
  const summary = typeof output.summary === "string" ? output.summary : "";
  return summary.trim();
}

/** Pure: deterministic fallback distillation — no model, just a clean, clipped headline. */
export function deterministicDistill(resultText: string, maxChars = MAX_FALLBACK_CHARS): string {
  const oneLine = resultText.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars - 1).trimEnd()}…` : oneLine;
}

/**
 * Pure: build the single line sent to the operator. Failed/cancelled runs —
 * or any run with no usable result text — get the fixed one-line failure
 * notice instead of an attempted distillation of nothing.
 */
export function buildLoopMessage(task: LoopCloserTask, distilled: string): string {
  const title = task.title?.trim() || "Task";
  const isFailure = FAILURE_STATUSES.has(task.status);
  if (isFailure || !distilled.trim()) {
    return `⚠️ ${title} didn't finish — it's on the board`;
  }
  return `✅ ${title}: ${distilled.trim()}`;
}

// ---------------------------------------------------------------------------
// Distillation (local model, deterministic fallback)
// ---------------------------------------------------------------------------

/**
 * Distill a task's result to <=2 short spoken-style sentences via the local
 * model. On any model failure (not configured, timeout, bad response) falls
 * back to a deterministic truncation. Never throws.
 */
export async function distillLoopResult(
  title: string,
  resultText: string,
  chatComplete: ChatComplete = localChatComplete,
): Promise<string> {
  if (!resultText.trim()) return "";
  try {
    const reply = await chatComplete(
      [
        {
          role: "system",
          content:
            "Distill the result of a completed task into at most two short, spoken-style " +
            "sentences suitable for a text message read aloud. Be concrete and specific. " +
            "No preamble, no markdown.",
        },
        { role: "user", content: `Task: ${title}\n\nResult:\n${resultText.slice(0, 4000)}` },
      ],
      { maxTokens: DISTILL_MAX_TOKENS, temperature: 0 },
    );
    const cleaned = reply.replace(/\s+/g, " ").trim();
    return cleaned || deterministicDistill(resultText);
  } catch {
    return deterministicDistill(resultText);
  }
}

// ---------------------------------------------------------------------------
// Orchestration (impure edges injected)
// ---------------------------------------------------------------------------

export interface LoopCloserDeps {
  chatComplete: ChatComplete;
  notify: typeof defaultNotify;
  sendApnsPush: typeof defaultSendApnsPush;
  /** Persist that this task has been notified. Merges into `output` — never
   * clobbers the rest of it. */
  markNotified: (taskId: string, notifiedAt: string) => Promise<void>;
  now: () => string;
}

async function defaultMarkNotified(taskId: string, notifiedAt: string): Promise<void> {
  const current = await Task.findById(taskId);
  const output = { ...((current?.output as Record<string, unknown> | undefined) ?? {}), loopNotifiedAt: notifiedAt };
  await Task.findByIdAndUpdate(taskId, { output });
}

export const defaultLoopCloserDeps: LoopCloserDeps = {
  chatComplete: localChatComplete,
  notify: defaultNotify,
  sendApnsPush: defaultSendApnsPush,
  markNotified: defaultMarkNotified,
  now: () => new Date().toISOString(),
};

/**
 * Close the voice loop for one task: idempotent (marks notified before
 * sending), noise-guarded (failed/cancelled/empty-result → one-line notice),
 * fire-and-forget (never throws — every failure is caught and logged).
 *
 * This is the ONE function the task runner's terminal-transition hook calls.
 */
export async function closeVoiceLoop(
  task: LoopCloserTask | null | undefined,
  deps: LoopCloserDeps = defaultLoopCloserDeps,
): Promise<void> {
  try {
    if (!shouldNotify(task)) return;
    const t = task as LoopCloserTask;

    const isFailure = FAILURE_STATUSES.has(t.status);
    const resultText = extractResultText(t);
    const distilled = isFailure || !resultText ? "" : await distillLoopResult(t.title, resultText, deps.chatComplete);
    const message = buildLoopMessage(t, distilled);

    // Mark notified BEFORE sending — a slow or failing send must never cause
    // a duplicate on a later terminal transition. Idempotence beats
    // guaranteed delivery here; delivery itself is best-effort.
    await deps.markNotified(t._id, deps.now());

    const [notifyResult, apnsResult] = await Promise.allSettled([
      deps.notify(message),
      deps.sendApnsPush({ title: "HiveMatrix", body: message }),
    ]);
    if (notifyResult.status === "rejected") {
      console.error(`[voice-loop-closer] notify() failed for task ${t._id}: ${String(notifyResult.reason)}`);
    }
    if (apnsResult.status === "rejected") {
      console.error(`[voice-loop-closer] APNs push failed for task ${t._id}: ${String(apnsResult.reason)}`);
    }
  } catch (err) {
    console.error(`[voice-loop-closer] failed for task ${task?._id ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
