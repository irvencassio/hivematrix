/**
 * Message Lane poller — the loop that routes inbound texts into Flash Lane and
 * texts needs_input questions back out.
 *
 * Inbound:  read chat.db since the high-water ROWID → route each message
 *           (allowlist gate) → resolve a waiting task OR dispatch to Flash Lane
 *           for a conversational reply. Flash handles both quick answers and
 *           complex work escalation via escalate_to_task internally.
 * Outbound: any Message Lane task that's waiting on its sender (needs_input) gets
 *           its question texted to that sender once.
 *
 * Runs inside the daemon; gated by the channel being enabled + chat.db readable.
 * The flashDispatch callback is injected by daemon/index.ts (only daemon/ imports
 * from flash/) — falls back to a no-op if not wired.
 */

import { Task, type TaskDoc } from "@/lib/db";
import { getPendingStuck, resolveStuck } from "@/lib/orchestrator/stuck";
import { handlesMatch } from "./contracts";
import { routeInbound, type PendingInput } from "./handoff";
import { readInboundSince, sendIMessage } from "./imessage";
import { wantsVoiceReply } from "@/lib/voice/tts";
import {
  isChannelEnabled, getLastRowid, setLastRowid, isAllowed, isBlocked, isSelf, getSelfHandles,
  recordInbound, recordOutbound, recordError,
  wasStuckNotified, markStuckNotified,
  wasDoneNotified, markDoneNotified, recordIgnoredSender,
} from "./store";
import { getLocation } from "@/lib/models/available";
import { startPollLoop } from "@/lib/lanes/poll-loop";

/** Injected by daemon/index.ts; accepts (text, peer, imagePaths?) and returns
 *  the Flash reply. imagePaths carries a photo-only or photo+caption message's
 *  image attachment paths through to Flash's vision-enabled turn. */
type FlashDispatch = (text: string, peer: string, imagePaths?: string[]) => Promise<string>;
let flashDispatch: FlashDispatch | null = null;

const POLL_INTERVAL_MS = 3_000;

function taskHandle(task: TaskDoc | null): string | null {
  const mb = (task?.output as { messagebee?: { handle?: string } } | undefined)?.messagebee;
  return mb?.handle ?? null;
}

/** Send, but never to one of the agent's own handles. Texting self on a shared
 *  Apple ID echoes back as inbound and loops; refuse and log instead. Returns
 *  false without sending when the target is a self-handle. */
async function sendGuarded(handle: string, text: string, attachments: string[] = []): Promise<boolean> {
  if (isSelf(handle)) {
    recordError(`refused to text self-handle ${handle} (would loop); set a distinct agent identity for two-way texting`);
    return false;
  }
  // Pin the sending account to the agent's own identity so a multi-account box
  // (dedicated agent Apple ID + personal) sends as the right one, not "1st account".
  return sendIMessage(handle, text, attachments, getSelfHandles()[0] ?? "");
}

/** Pending needs_input requests for Message Lane tasks owned by a given sender. */
async function pendingInputForSender(handle: string): Promise<PendingInput[]> {
  const out: PendingInput[] = [];
  for (const stuck of getPendingStuck()) {
    const task = await Task.findById(stuck.taskId);
    if (task?.source !== "messagebee") continue;
    const owner = taskHandle(task);
    if (owner && handlesMatch(owner, handle)) {
      out.push({ taskId: stuck.taskId, stuckTimestamp: stuck.timestamp });
    }
  }
  return out;
}

/** Process one inbound message end-to-end. */
async function handleInbound(msg: { rowid: number; handle: string; text: string; service: string; attachments?: string[] }): Promise<void> {
  // Loop-guard: on a shared Apple ID, the agent's own outbound to its own number
  // echoes back as is_from_me=0. Never treat that echo as an inbound message — it
  // would trigger a reply that echoes again, forever. Drop it silently (not even
  // surfaced as an ignored sender: it isn't a real correspondent).
  if (isSelf(msg.handle)) return;

  const route = routeInbound(
    {
      rowid: msg.rowid, handle: msg.handle, text: msg.text,
      receivedAt: new Date().toISOString(), service: msg.service, attachments: msg.attachments,
    },
    { allowlisted: isAllowed(msg.handle), pendingInput: await pendingInputForSender(msg.handle) },
  );

  if (route.kind === "ignore") {
    // Surface non-allowlisted senders so the operator can one-click allow them.
    if (!isAllowed(msg.handle) && !isBlocked(msg.handle)) recordIgnoredSender(msg.handle, msg.text);
    return;
  }

  if (route.kind === "reply_to_task") {
    const ok = await resolveStuck(route.taskId, route.stuckTimestamp, "reply", "messagebee", route.text);
    if (ok) await Task.findByIdAndUpdate(route.taskId, { reviewState: null });
    return;
  }

  // flash_turn — dispatch to Flash Lane for a conversational reply.
  // Append location so location-aware asks ("near me", local time) have it without
  // the agent having to ask. Flash handles escalation to background tasks internally.
  if (!flashDispatch) return;
  const loc = getLocation();
  const text = loc ? route.text + "\n\n[Operator location: " + loc + "]" : route.text;
  try {
    const reply = await flashDispatch(text, route.peer, route.imagePaths.length ? route.imagePaths : undefined);
    if (reply.trim()) {
      const sent = await sendGuarded(route.peer, reply);
      if (sent) recordOutbound();
    }
  } catch (err) {
    recordError(`flash dispatch failed for ${route.peer}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Text the RESULT of a finished messagebee task back to its sender (once). */
async function notifyCompletedResults(): Promise<void> {
  const tasks = await Task.find({ source: "messagebee", status: { $in: ["review", "done"] } });
  for (const task of tasks) {
    const key = `${task._id}:${task.updatedAt ?? ""}`;
    if (wasDoneNotified(key)) continue;
    const handle = taskHandle(task);
    if (!handle) continue;
    const out = (task.output ?? {}) as { summary?: string };
    const result = typeof out.summary === "string" ? out.summary.trim() : "";
    if (!result) continue;

    // Voice reply: if the sender asked for a spoken result, synth the summary to
    // a voice note (.m4a) and send that instead of text. Uses the same warm live
    // voice (Kokoro) as the iOS Talk surface so HiveMatrix sounds consistent —
    // the cloned persona is reserved for produced narration. Falls back to text
    // on any TTS failure so a result is never dropped.
    let body = result;
    let attachments: string[] = [];
    if (wantsVoiceReply(typeof task.description === "string" ? task.description : "")) {
      try {
        const { synthesizeLiveVoice } = await import("@/lib/voice/turn-server");
        const path = await synthesizeLiveVoice(result.slice(0, 1500));
        attachments = [path];
        body = ""; // send a clean voice note, no caption
      } catch (err) {
        recordError(`voice reply TTS failed, falling back to text: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const sent = await sendGuarded(handle, body, attachments);
    if (sent) { recordOutbound(); markDoneNotified(key); }
  }
}

/** Text out any unsent needs_input question for a messagebee task. */
async function notifyPendingInputs(): Promise<void> {
  for (const stuck of getPendingStuck()) {
    const key = `${stuck.taskId}:${stuck.timestamp}`;
    if (wasStuckNotified(key)) continue;
    const task = await Task.findById(stuck.taskId);
    if (task?.source !== "messagebee") continue;
    const handle = taskHandle(task);
    if (!handle) continue;
    const question = stuck.reason?.trim() || "HiveMatrix needs your input on a task. Reply to continue.";
    const sent = await sendGuarded(handle, question);
    if (sent) { recordOutbound(); markStuckNotified(key); }
  }
}

/** Read + route everything new, then push pending questions. Safe to call on a tick. */
export async function pollOnce(): Promise<void> {
  if (!isChannelEnabled()) return;
  try {
    const since = getLastRowid();
    const { messages, maxRowid } = readInboundSince(since, 50);
    for (const msg of messages) {
      await handleInbound(msg);
      recordInbound();
    }
    if (maxRowid > since) setLastRowid(maxRowid);
    await notifyPendingInputs();
    await notifyCompletedResults();
  } catch (err) {
    recordError(err instanceof Error ? err.message : String(err));
  }
}

let stopFn: (() => void) | null = null;

/** Start the poll loop (idempotent). Returns a stop function. */
export function startMessageBeePoller(intervalMs = POLL_INTERVAL_MS, dispatch?: FlashDispatch): () => void {
  flashDispatch = dispatch ?? null;
  if (stopFn) return stopMessageBeePoller;
  stopFn = startPollLoop({ name: "message-lane", intervalMs, tick: pollOnce });
  return stopMessageBeePoller;
}

export function stopMessageBeePoller(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
