/**
 * Voice override for the video script review — lets the operator review the drafted
 * video by voice: "read me the script", then "approve the video" / "cancel the video"
 * / "rework the video, cut the third story". Wired into /voice/turn before the generic
 * command layer so "approve the video" targets the pending draft, not an approval-queue
 * item. Detection is the pure tested core; this reads the latest pending draft and
 * applies the decision via resolveVideoDraft(). Returns null → fall through.
 */

import { readFileSync, existsSync } from "fs";
import { detectVideoVoiceIntent } from "./voice-intent";
import { pendingDrafts } from "./draft-store";
import { resolveVideoDraft } from "./news-review";
import { synthesizeSpeech } from "@/lib/voice/tts";

export interface VideoVoiceOverride {
  reply: string;
  audioBase64: string;
  command: { kind: string; draftId?: string };
}

/** Resolve a video-review voice command to a spoken answer. null = not a video
 * command, fall through. Never throws. */
export async function videoVoiceOverride(transcript: string): Promise<VideoVoiceOverride | null> {
  const intent = detectVideoVoiceIntent(transcript || "");
  if (intent.kind === "none") return null;

  let reply: string;
  let draftId: string | undefined;
  try {
    const draft = pendingDrafts()[0]; // the latest script awaiting review
    if (!draft) {
      reply = "There's no video script waiting for review right now.";
    } else if (intent.kind === "read") {
      const script = existsSync(draft.paths.script) ? readFileSync(draft.paths.script, "utf-8").trim() : "";
      reply = script
        ? `Here's the script for "${draft.title}":\n\n${script}\n\nSay "approve" to render and publish, or tell me what to change.`
        : `The draft "${draft.title}" has no script text yet.`;
      draftId = draft.id;
    } else {
      const replyText = intent.kind === "approve" ? "approve" : intent.kind === "cancel" ? "cancel" : (intent.feedback ?? "rework it");
      const out = await resolveVideoDraft(draft.id, replyText);
      reply = out?.reply ?? "I couldn't act on that draft.";
      draftId = draft.id;
    }
  } catch (e) {
    console.error(`[video-voice] ${intent.kind} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  let audioBase64 = "";
  try {
    const tts = await synthesizeSpeech(reply);
    audioBase64 = readFileSync(tts.path).toString("base64");
  } catch { /* speak-less fallback: the client shows the text reply */ }

  return { reply, audioBase64, command: { kind: `video-${intent.kind}`, draftId } };
}
