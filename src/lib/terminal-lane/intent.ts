/**
 * Pure intent detection for Terminal Lane requests. Mirrors news-intent.ts:
 * keyword regexes, no IO. Used by POST /tasks to route explicit Terminal Lane
 * work to the lane instead of a generic frontier agent (which would otherwise
 * fall back on stale Canopy guidance).
 */

// Explicit lane mention: "TerminalLane", "Terminal Lane", "terminal lane".
const LANE_RE = /\bterminal[\s-]*lane\b/i;

/** True when the text explicitly asks to use Terminal Lane. */
export function isTerminalLaneRequest(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return LANE_RE.test(t);
}

// Host-targeted phrasing: "... of <host>", "on <host>", "to <host>", "@<host>".
// A host token is a hostname/identifier (letters/digits/.-_), not a generic word.
const HOST_CUE_RE = /(?:\b(?:of|on|to|at|into|onto|host)\s+|@)([a-z0-9][a-z0-9._-]{1,62})\b/i;
// Words that look like hosts in the cue position but are not (avoid false hits).
const NON_HOST = new Set(["the", "a", "an", "it", "this", "that", "my", "your", "me", "us", "command", "server", "machine", "box", "remote", "local", "host"]);

/** Extract a likely target host token from host-targeted phrasing, or null. */
export function detectTerminalHostHint(text: string): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  // Prefer the LAST cue match (the object usually trails the verb/intent).
  let hint: string | null = null;
  const re = new RegExp(HOST_CUE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const token = m[1].toLowerCase();
    if (!NON_HOST.has(token)) hint = m[1];
  }
  return hint;
}
