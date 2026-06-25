/**
 * Message Lane poller — the loop that turns inbound texts into work and texts
 * needs_input questions back out.
 *
 * Inbound:  read chat.db since the high-water ROWID → route each message
 *           (allowlist gate) → resolve a waiting task or create a new one.
 * Outbound: any Message Lane task that's waiting on its sender (needs_input) gets
 *           its question texted to that sender once.
 *
 * Runs inside the daemon; gated by the channel being enabled + chat.db readable.
 */

import { homedir } from "os";
import { Task, type TaskDoc } from "@/lib/db";
import { getPendingStuck, resolveStuck } from "@/lib/orchestrator/stuck";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";
import { handlesMatch } from "./contracts";
import { routeInbound, type PendingInput } from "./handoff";
import { readInboundSince, sendIMessage } from "./imessage";
import { wantsVoiceReply } from "@/lib/voice/tts";
import {
  isChannelEnabled, getLastRowid, setLastRowid, isAllowed,
  recordInbound, recordOutbound, recordError,
  wasStuckNotified, markStuckNotified,
  wasDoneNotified, markDoneNotified, recordIgnoredSender,
} from "./store";
import { getLocation } from "@/lib/models/available";

const POLL_INTERVAL_MS = 3_000;

function taskHandle(task: TaskDoc | null): string | null {
  const mb = (task?.output as { messagebee?: { handle?: string } } | undefined)?.messagebee;
  return mb?.handle ?? null;
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
async function handleInbound(msg: { rowid: number; handle: string; text: string; service: string }): Promise<void> {
  const route = routeInbound(
    { rowid: msg.rowid, handle: msg.handle, text: msg.text, receivedAt: new Date().toISOString(), service: msg.service },
    { allowlisted: isAllowed(msg.handle), pendingInput: await pendingInputForSender(msg.handle) },
  );

  if (route.kind === "ignore") {
    // Surface non-allowlisted senders so the operator can one-click allow them.
    if (!isAllowed(msg.handle)) recordIgnoredSender(msg.handle, msg.text);
    return;
  }

  if (route.kind === "reply_to_task") {
    const ok = await resolveStuck(route.taskId, route.stuckTimestamp, "reply", "messagebee", route.text);
    if (ok) await Task.findByIdAndUpdate(route.taskId, { reviewState: null });
    return;
  }

  // new_task — share the operator's location so location-aware asks (weather,
  // "near me", local time) have it without the agent having to ask.
  const loc = getLocation();
  const description = loc ? route.description + "\n\n[Operator location: " + loc + "]" : route.description;
  await Task.create({
    title: route.title,
    description,
    project: DEFAULT_TASK_PROJECT,
    projectPath: homedir(),
    status: "backlog",
    executor: "agent",
    source: "messagebee",
    model: route.model ?? undefined,
    output: { messagebee: { handle: msg.handle, service: msg.service } },
  });
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

    const sent = await sendIMessage(handle, body, attachments);
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
    const sent = await sendIMessage(handle, question);
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

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the poll loop (idempotent). Returns a stop function. */
export function startMessageBeePoller(intervalMs = POLL_INTERVAL_MS): () => void {
  if (timer) return stopMessageBeePoller;
  timer = setInterval(() => {
    if (running) return; // never overlap two polls
    running = true;
    void pollOnce().finally(() => { running = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopMessageBeePoller;
}

export function stopMessageBeePoller(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
