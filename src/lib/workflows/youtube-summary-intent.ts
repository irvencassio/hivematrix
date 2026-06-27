/**
 * Pure intent detection for YouTube-summary requests on the POST /tasks ingress.
 *
 * Mirrors news-intent.ts / terminal-lane/intent.ts: small, IO-free helpers used to
 * route an explicit "summarize this YouTube video" request to the deterministic
 * content.youtube_summary review workflow instead of a generic Codex agent.
 *
 * The routing source of truth is the workflow def's `routing` block — this module
 * does NOT re-declare phrase/domain lists. It extracts URL hostnames from the text
 * and asks the registry to match, returning true only when the match resolves to
 * content.youtube_summary. One place, no drift.
 */

import { getWorkflowRegistry } from "./registry";
import { extractVideoId } from "./youtube-summary";

const WORKFLOW_ID = "content.youtube_summary";
// URLs in free text — stop at whitespace and common closing punctuation so a URL
// inside parentheses/brackets doesn't swallow the bracket.
const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
// Punctuation that commonly trails a URL in prose but is not part of it.
const TRAILING = /[.,;:!?'"]+$/;

function urlsIn(text: string): string[] {
  if (!text) return [];
  return [...text.matchAll(URL_RE)].map((m) => m[0].replace(TRAILING, ""));
}

/** First URL in the text that is a valid YouTube watch/short URL, or null. */
export function extractYoutubeUrlFromText(text: string): string | null {
  for (const url of urlsIn(text)) {
    if (extractVideoId(url)) return url;
  }
  return null;
}

/** Hostnames of every parseable URL in the text (in order). */
export function extractDomainsFromText(text: string): string[] {
  const out: string[] = [];
  for (const url of urlsIn(text)) {
    try {
      out.push(new URL(url).hostname);
    } catch {
      /* not a parseable URL — skip */
    }
  }
  return out;
}

/** True when the text should route to the content.youtube_summary workflow. Pure. */
export function isYoutubeSummaryRequest(text: string): boolean {
  if (!text || !text.trim()) return false;
  const match = getWorkflowRegistry().match({ text, domains: extractDomainsFromText(text) });
  return match?.id === WORKFLOW_ID;
}
