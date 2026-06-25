/**
 * Voice override for the video review — lets the operator drive the video lifecycle
 * by voice: "read me the script", "approve the video" (review → render+publish),
 * "publish the video" (a HeyGen portal_completed draft → publish-only, no re-render),
 * "cancel"/"rework". Wired into /voice/turn before the generic command layer.
 *
 * Detection is the pure tested core (voice-intent.ts). Routing here is STATUS-AWARE:
 * a portal_completed draft publishes its existing local MP4 (never re-renders), a
 * needs_publish_input draft is refused honestly (no local file), and a review draft
 * keeps the existing approve→render+publish path. Returns null → fall through.
 */

import { readFileSync, existsSync } from "fs";
import { detectVideoVoiceIntent } from "./voice-intent";
import { listDrafts, type VideoDraft } from "./draft-store";
import { resolveVideoDraft, publishDraftVideo, type PublishDraftResult } from "./news-review";
import { synthesizeSpeech } from "@/lib/voice/tts";

export interface VideoVoiceOverride {
  reply: string;
  audioBase64: string;
  command: { kind: string; draftId?: string };
}

export interface VideoVoiceDeps {
  /** Synthesize the spoken reply to an audio file, return its path. Default: the
   * cloned voice; the /voice/turn caller injects the warm live (Kokoro) voice so
   * Talk replies stay in one consistent voice. */
  synthesize?: (text: string) => Promise<string>;
  /** The latest actionable draft (review or portal state). Injectable for tests. */
  latestDraft?: () => VideoDraft | null;
  /** Publish-only path for a portal_completed draft. Injectable for tests. */
  publishDraft?: (id: string) => Promise<PublishDraftResult>;
  /** Apply a review reply (approve / cancel / rework). Injectable for tests. */
  resolveDraft?: (id: string, reply: string) => Promise<{ reply: string } | null>;
}

// Statuses the operator can still act on by voice (review + the portal lifecycle).
const ACTIONABLE = new Set(["review", "portal_pending", "portal_completed", "needs_publish_input"]);

function defaultLatestDraft(): VideoDraft | null {
  return listDrafts().find((d) => ACTIONABLE.has(d.status)) ?? null;
}

/** A spoken, honest one-liner for a draft's current portal/review state. */
function statusLine(draft: VideoDraft): string {
  switch (draft.status) {
    case "portal_pending":
      return `The HeyGen portal task for "${draft.title}" is still running. I'll have the video once it finishes.`;
    case "portal_completed":
      return `"${draft.title}" is rendered in the HeyGen portal and ready to publish — say "publish the video".`;
    case "needs_publish_input":
      return `"${draft.title}" finished in the HeyGen portal, but only a link or note came back — there's no local video file, so I can't upload it. Publish it manually${draft.portalVideoUrl ? ` from ${draft.portalVideoUrl}` : ""}.`;
    default:
      return `"${draft.title}" is awaiting review.`;
  }
}

/** Resolve a video-review voice command to a spoken answer. null = not a video
 * command, fall through. Never throws. */
export async function videoVoiceOverride(transcript: string, deps: VideoVoiceDeps = {}): Promise<VideoVoiceOverride | null> {
  const intent = detectVideoVoiceIntent(transcript || "");
  if (intent.kind === "none") return null;

  const resolveDraft = deps.resolveDraft ?? resolveVideoDraft;
  const publish = deps.publishDraft ?? publishDraftVideo;

  let reply: string;
  let draftId: string | undefined;
  try {
    const draft = (deps.latestDraft ?? defaultLatestDraft)();
    if (!draft) {
      reply = "There's no video script waiting for review right now.";
    } else {
      draftId = draft.id;
      if (intent.kind === "read") {
        const script = existsSync(draft.paths.script) ? readFileSync(draft.paths.script, "utf-8").trim() : "";
        if (draft.status === "review") {
          reply = script
            ? `Here's the script for "${draft.title}":\n\n${script}\n\nSay "approve" to render and publish, or tell me what to change.`
            : `The draft "${draft.title}" has no script text yet.`;
        } else {
          reply = script ? `Here's the script for "${draft.title}":\n\n${script}\n\n${statusLine(draft)}` : statusLine(draft);
        }
      } else if (intent.kind === "approve") {
        // "approve"/"publish": route by status. A portal_completed draft publishes its
        // existing local MP4 (no re-render); needs_publish_input is refused; a review
        // draft keeps the existing approve→render+publish path.
        if (draft.status === "portal_completed") {
          const r = await publish(draft.id);
          reply = r.ok
            ? `Published "${draft.title}" to YouTube${r.youtubeUrl ? `: ${r.youtubeUrl}` : ""}.`
            : `I couldn't publish "${draft.title}": ${r.reason ?? "unknown error"}.`;
        } else if (draft.status === "needs_publish_input" || draft.status === "portal_pending") {
          reply = statusLine(draft); // honest: not publishable yet / no local file
        } else {
          const out = await resolveDraft(draft.id, "approve");
          reply = out?.reply ?? "I couldn't act on that draft.";
        }
      } else {
        // cancel / rework — the review flow. For a portal draft, resolve returns null;
        // speak the honest status instead.
        const replyText = intent.kind === "cancel" ? "cancel" : (intent.feedback ?? "rework it");
        const out = await resolveDraft(draft.id, replyText);
        reply = out?.reply ?? statusLine(draft);
      }
    }
  } catch (e) {
    console.error(`[video-voice] ${intent.kind} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  let audioBase64 = "";
  try {
    const path = deps.synthesize ? await deps.synthesize(reply) : (await synthesizeSpeech(reply)).path;
    audioBase64 = path ? readFileSync(path).toString("base64") : "";
  } catch { /* speak-less fallback: the client shows the text reply */ }

  return { reply, audioBase64, command: { kind: `video-${intent.kind}`, draftId } };
}
