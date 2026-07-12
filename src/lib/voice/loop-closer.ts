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
 * `closeVoiceLoop` is one of two entry points the task runner calls at its
 * one terminal-transition hook (src/lib/orchestrator/agent-manager.ts,
 * `handleExit`). It NEVER throws — every failure is caught and logged as a
 * one-line notice, because a notification hiccup must never take down the
 * task runner.
 *
 * `closeFlashThread` (below) is a SIBLING concern, called from the same
 * hook: ANY task escalated off a Flash session — chat or voice, keyed on
 * `source` starting with "flash:" rather than `output.origin === "voice"` —
 * gets its result appended back into the originating conversation thread,
 * idempotently, via `output.threadPostedAt`. It is independent of the
 * voice-origin OS-notification gate above; a task can satisfy either gate,
 * both, or neither.
 */

import { notify as defaultNotify } from "@/lib/notify/notify";
import { sendPush as defaultSendPush } from "@/lib/notify/push";
import { haikuChatComplete, type ChatComplete } from "@/lib/models/chat-client";
import { Task } from "@/lib/db";
import { broadcastEvent } from "@/lib/ws/broadcaster";

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
 * Distill a task's result to <=2 short spoken-style sentences via Haiku (the
 * subscription-OAuth Claude CLI). On any model failure (CLI not configured,
 * timeout, bad response) falls back to a deterministic truncation. Never throws.
 */
export async function distillLoopResult(
  title: string,
  resultText: string,
  chatComplete: ChatComplete = haikuChatComplete,
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
  sendPush: typeof defaultSendPush;
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
  chatComplete: haikuChatComplete,
  notify: defaultNotify,
  sendPush: defaultSendPush,
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

    const [notifyResult, pushResult] = await Promise.allSettled([
      deps.notify(message),
      deps.sendPush({ title: "HiveMatrix", body: message }),
    ]);
    if (notifyResult.status === "rejected") {
      console.error(`[voice-loop-closer] notify() failed for task ${t._id}: ${String(notifyResult.reason)}`);
    }
    if (pushResult.status === "rejected") {
      console.error(`[voice-loop-closer] push failed for task ${t._id}: ${String(pushResult.reason)}`);
    }
  } catch (err) {
    console.error(`[voice-loop-closer] failed for task ${task?._id ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Flash thread close-the-loop — a SIBLING concern to closeVoiceLoop's OS-
// notification gate above (which requires output.origin === "voice"). Every
// task escalated off a Flash session (chat OR voice — see flash-mcp.ts's
// handleEscalateToTask, which stamps `source: flash:${sessionId}` on both
// paths) must have its result posted back into the originating conversation
// thread, not just voice ones. This is a separate function with its own gate
// so it runs for every `flash:` source, never narrowed to voice-only.
// ---------------------------------------------------------------------------

const FLASH_SOURCE_PREFIX = "flash:";

/** Pure: extract the originating Flash session id from a task's `source`
 * field (e.g. "flash:abc123" -> "abc123"), or null if this task didn't come
 * from a Flash session (or the id half is empty/whitespace). */
export function flashSessionIdFromSource(source?: string | null): string | null {
  if (!source || !source.startsWith(FLASH_SOURCE_PREFIX)) return null;
  const id = source.slice(FLASH_SOURCE_PREFIX.length).trim();
  return id || null;
}

/** The subset of a Task the thread-poster needs, on top of LoopCloserTask's
 * fields — just the `source` string that carries the originating session id. */
export interface FlashThreadTask extends LoopCloserTask {
  source?: string | null;
}

/**
 * True when `task` escalated from a Flash session (chat or voice — any
 * `source` starting with "flash:"), just reached a terminal state, and
 * hasn't already been posted back to that thread. Mirrors shouldNotify's
 * idempotence + terminal-state + waiting_children guards, keyed on
 * `output.threadPostedAt` instead of `output.loopNotifiedAt` so the two
 * gates (OS notification vs. thread post) track independently — a task can
 * satisfy one, both, or neither.
 */
export function shouldPostToThread(task: FlashThreadTask | null | undefined): boolean {
  if (!task) return false;
  if (!flashSessionIdFromSource(task.source)) return false;
  const output = task.output ?? {};
  if (output.threadPostedAt) return false;
  if (!TERMINAL_STATUSES.has(task.status)) return false;
  if (task.reviewState === "waiting_children") return false;
  return true;
}

/** Append a turn to a Flash session's thread. Injected because voice/ must
 *  not import flash/ (see flash-mcp.ts's deliverLearnSkillReply comment for
 *  the mirror rule — flash/ may import voice/, never the reverse) — the
 *  daemon wires the real `@/lib/flash/store`#appendTurn in at startup via
 *  `setFlashThreadAppender`, same bridging pattern as
 *  lib/ws/broadcaster.ts's setBroadcastFn. */
type FlashAppendTurnFn = (sessionId: string, role: string, content: string) => void;

let _appendFlashTurn: FlashAppendTurnFn | null = null;

/** Daemon-only wiring hook — call once at startup with the real appendTurn. */
export function setFlashThreadAppender(fn: FlashAppendTurnFn): void {
  _appendFlashTurn = fn;
}

function defaultAppendFlashTurn(sessionId: string, role: string, content: string): void {
  if (!_appendFlashTurn) {
    console.error("[flash-thread] appendFlashTurn not wired (setFlashThreadAppender) — dropping thread post");
    return;
  }
  _appendFlashTurn(sessionId, role, content);
}

async function defaultMarkThreadPosted(taskId: string, postedAt: string): Promise<void> {
  const current = await Task.findById(taskId);
  const output = { ...((current?.output as Record<string, unknown> | undefined) ?? {}), threadPostedAt: postedAt };
  await Task.findByIdAndUpdate(taskId, { output });
}

export interface FlashThreadDeps {
  chatComplete: ChatComplete;
  appendTurn: FlashAppendTurnFn;
  /** SSE fan-out so open clients refresh — emits "flash:appended" {sessionId}. */
  broadcastEvent: (event: string, data: unknown) => void;
  /** Persist that this task has been posted. Merges into `output` — never
   * clobbers the rest of it. */
  markThreadPosted: (taskId: string, postedAt: string) => Promise<void>;
  now: () => string;
}

export const defaultFlashThreadDeps: FlashThreadDeps = {
  chatComplete: haikuChatComplete,
  appendTurn: defaultAppendFlashTurn,
  broadcastEvent,
  markThreadPosted: defaultMarkThreadPosted,
  now: () => new Date().toISOString(),
};

/**
 * Close the Flash thread loop for one task: idempotent (marks posted before
 * appending), reuses the same buildLoopMessage template closeVoiceLoop uses
 * (so a task that is BOTH voice-origin and flash-sourced reads the same way
 * in the notification and in the thread), fire-and-forget (never throws).
 *
 * This is a SIBLING to closeVoiceLoop — callable from the same
 * terminal-transition hook (agent-manager.ts's handleExit), with its own
 * independent gate (`shouldPostToThread`) that covers every `flash:` source,
 * not just voice-origin ones.
 */
export async function closeFlashThread(
  task: FlashThreadTask | null | undefined,
  deps: FlashThreadDeps = defaultFlashThreadDeps,
): Promise<void> {
  try {
    if (!shouldPostToThread(task)) return;
    const t = task as FlashThreadTask;
    const sessionId = flashSessionIdFromSource(t.source) as string;

    const isFailure = FAILURE_STATUSES.has(t.status);
    const resultText = extractResultText(t);
    const distilled = isFailure || !resultText ? "" : await distillLoopResult(t.title, resultText, deps.chatComplete);
    const message = buildLoopMessage(t, distilled);

    // Mark posted BEFORE appending — a slow or failing append must never
    // cause a duplicate on a later terminal transition, same ordering
    // rationale as closeVoiceLoop's markNotified-before-send.
    await deps.markThreadPosted(t._id, deps.now());

    deps.appendTurn(sessionId, "assistant", message);
    deps.broadcastEvent("flash:appended", { sessionId });
  } catch (err) {
    console.error(`[flash-thread] failed for task ${task?._id ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
