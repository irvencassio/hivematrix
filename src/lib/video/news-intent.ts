/**
 * Detect "make me an AI-news video" so a free-form task routes STRAIGHT to the
 * structured draft→review flow (one review task with the full script + edit),
 * instead of a general agent that spawns a second review task plus a summary.
 *
 * Deliberately narrow: a create verb + "video" + a news cue. A generic
 * "make a video about cats" has no news cue, so it stays a normal agent task
 * (which the factory README still steers to review-before-render).
 */

const CREATE_RE = /\b(create|make|draft|generate|produce|build|record|do|put together)\b/i;
const VIDEO_RE = /\b(video|clip|reel|news\s*brief|news\s*update)\b/i;
const NEWS_RE = /\b(ai[\s-]*news|news|headlines|news\s*brief|ai\s*update|tech\s*news|today'?s\s*(?:ai|tech)?\s*news)\b/i;

/** True when the text asks to create an AI-news video. Pure. */
export function isAiNewsVideoRequest(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;
  return CREATE_RE.test(t) && VIDEO_RE.test(t) && NEWS_RE.test(t);
}
