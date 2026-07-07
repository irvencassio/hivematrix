/**
 * Voice result return path. A voice turn that can't be answered live escalates to
 * a full agent task (see server.ts /voice/turn + session.ts). That was fire-and-
 * forget: the operator heard "I'm looking into it" but the ANSWER never came back.
 *
 * This loop watches voice-originated tasks (source="voice", carrying
 * output.voice.sessionId) and, when one reaches a terminal state, speaks the
 * result in the live Kokoro voice and pushes a `voice:result` SSE event. The open
 * iOS Talk screen plays it (a closed session simply misses it — by design, the
 * client subscribes only while open).
 *
 * Dedup is in-memory: the first tick SEEDS (so already-finished tasks from before
 * startup aren't replayed), then each newly-terminal task delivers once.
 */

import { readFileSync } from "fs";
import { broadcastEvent } from "@/lib/ws/broadcaster";
import { startPollLoop } from "@/lib/lanes/poll-loop";

const TERMINAL = new Set(["review", "done", "failed"]);
const POLL_INTERVAL_MS = 4_000;
const MAX_SPOKEN_CHARS = 600;

export interface VoiceResultTask {
  _id: string;
  status: string;
  source?: string;
  output?: Record<string, unknown> | null;
}

export interface VoiceResultDeps {
  listVoiceTasks?: () => Promise<VoiceResultTask[]>;
  synthesize?: (text: string) => Promise<string | null>; // -> .m4a path, or null/throw
  readAudioBase64?: (path: string) => string;
  broadcast?: (event: string, data: unknown) => void;
}

/** Pure: the voice marker on a task, if it's a deliverable voice task. */
export function voiceMarker(task: VoiceResultTask): { sessionId: string; surface?: string } | null {
  const voice = (task.output as { voice?: { sessionId?: unknown; surface?: unknown } } | undefined)?.voice;
  if (!voice || typeof voice.sessionId !== "string" || !voice.sessionId) return null;
  return { sessionId: voice.sessionId, surface: typeof voice.surface === "string" ? voice.surface : undefined };
}

/** Pure: the spoken result text for a finished voice task ("" → nothing to say). */
export function voiceResultText(task: VoiceResultTask): string {
  if (task.status === "failed") {
    return "I couldn't finish that one — check the board for details.";
  }
  const summary = (task.output as { summary?: unknown } | undefined)?.summary;
  const text = typeof summary === "string" ? summary.trim() : "";
  if (!text) return "";
  // Strip light markdown + collapse whitespace for natural speech, then cap length.
  const clean = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > MAX_SPOKEN_CHARS ? clean.slice(0, MAX_SPOKEN_CHARS - 1).trimEnd() + "…" : clean;
}

const _delivered = new Set<string>();
let _seeded = false;

/** Test seam: reset dedup state. */
export function _resetVoiceResultState(): void {
  _delivered.clear();
  _seeded = false;
}

/**
 * One delivery pass. Returns the number of results pushed. Never throws.
 * On the first call it seeds (marks all currently-terminal voice tasks as seen)
 * so a backlog isn't replayed; thereafter it delivers each newly-finished task once.
 */
export async function deliverVoiceResults(deps: VoiceResultDeps = {}): Promise<number> {
  const listVoiceTasks = deps.listVoiceTasks ?? defaultListVoiceTasks;
  const broadcast = deps.broadcast ?? broadcastEvent;

  let tasks: VoiceResultTask[];
  try {
    tasks = await listVoiceTasks();
  } catch (e) {
    console.error(`[voice-result] list failed: ${e instanceof Error ? e.message : e}`);
    return 0;
  }

  if (!_seeded) {
    for (const t of tasks) if (TERMINAL.has(t.status) && voiceMarker(t)) _delivered.add(t._id);
    _seeded = true;
    return 0;
  }

  let delivered = 0;
  for (const task of tasks) {
    if (!TERMINAL.has(task.status)) continue;
    const marker = voiceMarker(task);
    if (!marker) continue;
    if (_delivered.has(task._id)) continue;
    _delivered.add(task._id);
    if (_delivered.size > 2000) _delivered.clear(); // bound

    const text = voiceResultText(task);
    if (!text) continue;

    let audioBase64 = "";
    try {
      const synthesize = deps.synthesize ?? defaultSynthesize;
      const path = await synthesize(text);
      if (path) audioBase64 = (deps.readAudioBase64 ?? defaultReadAudioBase64)(path);
    } catch { /* speak-less: client shows the text */ }

    broadcast("voice:result", {
      taskId: task._id,
      sessionId: marker.sessionId,
      text,
      audioBase64,
      ok: task.status !== "failed",
    });
    delivered++;
  }
  return delivered;
}

async function defaultListVoiceTasks(): Promise<VoiceResultTask[]> {
  const { Task } = await import("@/lib/db");
  const rows = await Task.find({ source: "voice" }).sort({ updatedAt: -1 }).limit(50);
  return rows.map((t) => ({ _id: t._id, status: t.status, source: t.source, output: t.output as Record<string, unknown> }));
}

async function defaultSynthesize(text: string): Promise<string | null> {
  const { synthesizeLiveVoice } = await import("./turn-server");
  return synthesizeLiveVoice(text);
}

function defaultReadAudioBase64(path: string): string {
  return path ? readFileSync(path).toString("base64") : "";
}

let stopFn: (() => void) | null = null;

/** Start the voice-result delivery loop (idempotent). Returns a stop fn. */
export function startVoiceResultLoop(deps: VoiceResultDeps = {}, intervalMs = POLL_INTERVAL_MS): () => void {
  if (stopFn) return stopVoiceResultLoop;
  stopFn = startPollLoop({ name: "voice-result", intervalMs, tick: async () => { await deliverVoiceResults(deps); } });
  return stopVoiceResultLoop;
}

export function stopVoiceResultLoop(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
