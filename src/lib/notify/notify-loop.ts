/**
 * Notification loop: pushes escalations out and reads button taps back.
 *
 *  - escalation tick: any new pending stuck task or approval is pushed to the
 *    founder via notify() — Telegram gets inline action buttons.
 *  - telegram tick: long-polls getUpdates; an allowlisted button tap resolves
 *    the stuck/approval the same way the console would.
 *
 * Dedup of outbound escalations is in-memory (a restart may re-notify a still
 * pending item once — acceptable).
 */

import { getPendingStuck, resolveStuck } from "@/lib/orchestrator/stuck";
import { getPendingApprovals, resolveApproval } from "@/lib/orchestrator/approval";
import { Task } from "@/lib/db";
import { notify } from "./notify";
import {
  getTelegramConfig, getUpdates, isAuthorizedUpdate, parseCallbackData,
  answerCallback, editMessageText, stuckKeyboard, approvalKeyboard,
} from "./telegram";

const ESCALATION_INTERVAL_MS = 5_000;
const notified = new Set<string>();

function mark(key: string): boolean {
  if (notified.has(key)) return false;
  notified.add(key);
  if (notified.size > 1000) notified.clear(); // bound
  return true;
}

// Failure escalation tracks the set of currently-failed task ids. On the first
// tick it SEEDS (so a backlog of old failures on startup isn't re-announced),
// then notifies each newly-failed task once. Reassigning the set each tick
// auto-prunes ids that are no longer failed and bounds memory.
let failuresSeeded = false;
let knownFailedIds = new Set<string>();

/** Push any task that newly entered the "failed" state out to the founder. */
async function notifyFailures(): Promise<void> {
  const failed = await Task.find({ status: "failed" });
  const currentIds = new Set(failed.map((t) => String(t._id)));
  if (!failuresSeeded) {
    failuresSeeded = true;
    knownFailedIds = currentIds;
    return;
  }
  for (const t of failed) {
    if (knownFailedIds.has(String(t._id))) continue;
    // Skip internal directive phase tasks (planner/reviewer/retrospective): they
    // churn and self-retry, so escalating them is noise. Real work failures stay.
    if ((t.output as { directivePhase?: unknown } | undefined)?.directivePhase) continue;
    const err = typeof t.error === "string" && t.error.trim() ? `\n${t.error.slice(0, 200)}` : "";
    await notify(`⚠️ Task failed: ${t.title ?? "(untitled)"}${err}`);
  }
  knownFailedIds = currentIds;
}

/** Push any new pending stuck/approval/failure out to the founder's channels. */
export async function escalationTick(): Promise<void> {
  for (const s of getPendingStuck()) {
    const key = `stuck:${s.taskId}:${s.timestamp}`;
    if (!mark(key)) continue;
    const text = `⚠️ Task needs input\n${s.reason || "(no detail)"}\n\nReply or tap an action.`;
    await notify(text, { telegramMarkup: stuckKeyboard(s.taskId, s.timestamp) });
  }
  for (const a of getPendingApprovals()) {
    const key = `approval:${a.taskId}:${a.timestamp}`;
    if (!mark(key)) continue;
    const text = `🔐 Approval needed\nTool: ${a.tool}\n${a.command}\n${a.context ?? ""}`.slice(0, 1500);
    await notify(text, { telegramMarkup: approvalKeyboard(a.taskId, a.timestamp) });
  }
  await notifyFailures();
}

let tgOffset = 0;

/** Long-poll Telegram for button taps and resolve them. */
export async function telegramTick(): Promise<void> {
  const cfg = getTelegramConfig();
  if (!cfg) return;
  const updates = await getUpdates(cfg, tgOffset);
  for (const u of updates) {
    tgOffset = Math.max(tgOffset, u.update_id + 1);
    const cq = u.callback_query;
    if (!cq?.data || !isAuthorizedUpdate(cfg, u)) continue;
    const parsed = parseCallbackData(cq.data);
    if (!parsed) { await answerCallback(cfg, cq.id, "Malformed action"); continue; }

    let ok = false;
    if (parsed.kind === "stuck") {
      ok = await resolveStuck(parsed.id, parsed.timestamp, parsed.decision, "telegram");
    } else {
      const d = parsed.decision === "approve" ? "approve" : "denied";
      await resolveApproval(parsed.id, parsed.timestamp, d, "telegram");
      ok = true;
    }
    await answerCallback(cfg, cq.id, ok ? `Done: ${parsed.decision}` : "Already resolved");
    const msgId = cq.message?.message_id;
    if (msgId) await editMessageText(cfg, msgId, `→ ${parsed.decision} (via Telegram)`);
  }
}

let escTimer: ReturnType<typeof setInterval> | null = null;
let tgRunning = false;

/** Start the notification loop (idempotent). Returns a stop fn. */
export function startNotifyLoop(
  intervalMs = ESCALATION_INTERVAL_MS,
  ticks: { escalation?: () => Promise<void>; telegram?: () => Promise<void> } = {},
): () => void {
  if (escTimer) return stopNotifyLoop;
  const esc = ticks.escalation ?? escalationTick;
  const tg = ticks.telegram ?? telegramTick;
  const logTickError = (name: string) => (e: unknown) => {
    console.error(`[notify] ${name} tick failed: ${e instanceof Error ? e.message : e}`);
  };
  let escRunning = false;
  escTimer = setInterval(() => {
    if (!escRunning) {
      escRunning = true;
      void esc().catch(logTickError("escalation")).finally(() => { escRunning = false; });
    }
    // Telegram long-poll runs back-to-back, not on the escalation cadence.
    if (!tgRunning && (ticks.telegram || getTelegramConfig())) {
      tgRunning = true;
      void tg().catch(logTickError("telegram")).finally(() => { tgRunning = false; });
    }
  }, intervalMs);
  if (typeof escTimer.unref === "function") escTimer.unref();
  return stopNotifyLoop;
}

export function stopNotifyLoop(): void {
  if (escTimer) { clearInterval(escTimer); escTimer = null; }
}
