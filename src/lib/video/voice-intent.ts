/**
 * Pure detection for video-review voice commands. Kept separate from the daemon IO
 * (voice-turn.ts) so it's fully unit-testable. Order: read → approve → cancel →
 * rework. An utterance that doesn't mention the video/script returns "none".
 */

export type VideoVoiceKind = "read" | "approve" | "cancel" | "rework" | "none";
export interface VideoVoiceIntent { kind: VideoVoiceKind; feedback?: string }

const clean = (s: string) => s.replace(/[.?!,\s]+$/g, "").trim();

/** Detect a video-review command in a spoken utterance. Pure. */
export function detectVideoVoiceIntent(text: string): VideoVoiceIntent {
  const t = (text || "").toLowerCase().trim();
  if (!t) return { kind: "none" };
  // Must be about the video/news script to claim the turn.
  const aboutVideo = /\b(video|news script|the script|the draft)\b/.test(t);
  if (!aboutVideo) return { kind: "none" };

  // Read it aloud.
  if (/\bread\b/.test(t)) return { kind: "read" };

  // Approve → render + publish.
  if (/\b(approve|publish|ship|render|post|send)\b/.test(t)) return { kind: "approve" };

  // Cancel → nothing spent.
  if (/\b(cancel|scrap|reject|kill|discard|trash)\b/.test(t)) return { kind: "cancel" };

  // Rework with feedback ("rework the video, cut the third story").
  const rework = (text || "").match(/\b(?:rework|redo|regenerate|change|fix|revise|edit)\b[^,:]*(?:[,:]\s*|\s+to\s+|\s+and\s+)?(.*)$/i);
  if (/\b(rework|redo|regenerate|change|fix|revise|edit)\b/.test(t)) {
    return { kind: "rework", feedback: rework && clean(rework[1]) ? clean(rework[1]) : undefined };
  }

  return { kind: "none" };
}
