/**
 * On-demand digest — "drop in a link, get a summary saved to the brain for review"
 * (scenario #43, the article path the YouTube watcher doesn't cover). The agent
 * fetches the URL through Browser Lane, summarizes, and writes a markdown brain doc
 * with the summary + source link. Pure helpers here; the task does the work.
 */

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** A filesystem-safe slug from a URL (host + first path segment). */
export function digestSlug(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean).slice(0, 2).join("-");
    return `${host}${seg ? `-${seg}` : ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "link";
  } catch {
    return "link";
  }
}

export function digestDocFilename(url: string, dateStr: string): string {
  return `${dateStr}-digest-${digestSlug(url)}.md`;
}

export interface DigestTaskInput {
  url: string;
  note?: string;
  /** Absolute path the agent should write the digest doc to. */
  docPath: string;
}

/** The task instructions: fetch → summarize → write a brain doc. */
export function buildDigestTaskDescription(input: DigestTaskInput): string {
  const lines = [
    `Digest this link for later review and save it to the knowledge base: ${input.url}`,
    "",
    "Steps:",
    "1. Fetch the page content — use hivematrix_browser with mode=read/search, or mode=workflow if it needs a logged-in/rendered page.",
    "2. Write a tight, information-dense summary: a 4-8 sentence overview, then 3-6 key takeaways as bullets.",
    `3. Save it as a markdown brain doc using write_file at exactly this path: ${input.docPath}`,
    "   The doc must start with a '# <title>' heading, then the summary, then a 'Source: <url>' line at the end.",
  ];
  if (input.note?.trim()) lines.push(`4. Incorporate this note from the operator: ${input.note.trim()}`);
  lines.push("", "Keep it factual. If the page can't be fetched, say so in the doc rather than inventing content.");
  return lines.join("\n");
}
