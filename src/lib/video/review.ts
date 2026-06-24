/**
 * Video script review — the deterministic core of the human-in-the-loop checkpoint
 * for the video factory. The pipeline drafts a script, PAUSES, and the operator
 * replies (console Reply / iOS / voice). This classifies that reply into an action
 * so the expensive HeyGen render (~$0.05/sec) only runs on an explicit approval —
 * and so a bad script gets edited or reworked, not published. Pure + unit-tested.
 *
 * Fits the HiveMatrix flow: a drafted video becomes a `needs_input` task; the same
 * Reply box that answers any task drives approve / edit / regenerate / cancel here.
 */

export type ReviewAction = "approve" | "edit" | "regenerate" | "cancel";

export interface ReviewDecision {
  action: ReviewAction;
  script?: string;    // edit: the operator's replacement script text
  feedback?: string;  // regenerate: the change request to re-draft with
}

// Short affirmatives → approve (render + publish). Empty reply also = approve
// (the natural "looks good, ship it" tap).
const APPROVE = /^(approve|approved|ship it|ship|publish|post it|go|send it|lgtm|looks good|sounds good|perfect|great|yes|yep|yeah|ok|okay|👍|🚀)\.?$/i;
// Short negatives → cancel (nothing rendered or spent).
const CANCEL = /^(cancel|scrap|discard|stop|abort|no|nope|kill it|don'?t|delete|trash|reject)\.?$/i;

/** A reply long/structured enough to be a full replacement script vs. a short
 * editing instruction. Heuristic: multiple non-empty lines, or many words. Pure. */
export function looksLikeFullScript(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return lines >= 2 || words >= 40;
}

/**
 * Classify an operator reply to a drafted video script. Pure.
 * - empty / "approve" / "ship it" → approve (render + publish)
 * - "cancel" / "scrap" / "no"     → cancel
 * - a long/multi-line reply       → edit (use it as the new script)
 * - a short instruction           → regenerate (re-draft with it as feedback)
 */
export function classifyReply(reply: string): ReviewDecision {
  const text = (reply ?? "").trim();
  if (!text) return { action: "approve" };
  if (APPROVE.test(text)) return { action: "approve" };
  if (CANCEL.test(text)) return { action: "cancel" };
  if (looksLikeFullScript(text)) return { action: "edit", script: text };
  return { action: "regenerate", feedback: text };
}

/** Spoken/text confirmation of a decision (reused by voice + console). Pure. */
export function decisionReply(d: ReviewDecision, title: string): string {
  const t = title || "the video";
  switch (d.action) {
    case "approve": return `Approved — rendering and publishing "${t}".`;
    case "edit": return `Got it — using your edited script for "${t}" and rendering now.`;
    case "regenerate": return `Reworking the script${d.feedback ? `: ${d.feedback}` : ""}. I'll send the new draft for review.`;
    case "cancel": return `Cancelled "${t}". Nothing was rendered or published.`;
  }
}

/** The review task body the operator answers. Shows the FULL script (so it can
 * actually be reviewed), normalized to single spacing for readability. A safety
 * cap keeps a runaway script from blowing up the task body, but a normal ~220-word
 * script is shown in full. */
export function reviewPrompt(script: string): string {
  const full = script.trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  const MAX = 4000; // generous — a 90s script is ~1300 chars; only truncates the pathological case
  const shown = full.length > MAX ? `${full.slice(0, MAX).trimEnd()}…` : full;
  return `Review this AI-news video script before it renders (HeyGen costs ~$0.05/sec, so I won't render until you say so):\n\n"${shown}"\n\nReply "approve" to render + publish, paste an edited script to use instead, give a short note (e.g. "cut the third story") to rework it, or "cancel".`;
}
