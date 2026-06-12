/**
 * Derive a task title from its instructions when none is given.
 * Takes the first sentence, capped to ~60 chars at a word boundary.
 */
export function deriveTaskTitle(description: string | null | undefined, maxLen = 60): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled task";

  // First sentence (stop at . ! ? followed by space/end), else the whole text.
  const sentenceMatch = text.match(/^.*?[.!?](?:\s|$)/);
  let candidate = (sentenceMatch ? sentenceMatch[0] : text).trim().replace(/[.!?]+$/, "");

  if (candidate.length <= maxLen) return candidate || "Untitled task";

  // Cut at the last word boundary within maxLen; fall back to a hard cut.
  const slice = candidate.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  candidate = (lastSpace > 20 ? slice.slice(0, lastSpace) : slice).trim();
  return candidate + "…";
}
