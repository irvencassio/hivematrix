/**
 * On-demand digest — "drop in a link, get a summary saved to the brain for review"
 * (scenario #43, the article path the YouTube watcher doesn't cover). The agent
 * fetches the URL through Browser Lane, summarizes, and writes a brain doc with
 * the summary + source link. Pure helpers here; the task does the work.
 *
 * YouTube links get richer treatment: a self-contained HTML doc with the video
 * thumbnail, a clickable link to the original, a solid detailed summary, and an
 * "applicability to my goals" section (HiveMatrix, Solo Founder OS, other goals).
 */

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** The YouTube video id for a watch/short/embed/youtu.be URL, else null. */
export function youTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    const ok = (id: string | null | undefined): string | null =>
      id && /^[\w-]{6,}$/.test(id) ? id : null;
    if (host === "youtu.be") return ok(u.pathname.split("/").filter(Boolean)[0]);
    if (host === "youtube.com") {
      if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
      const m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([\w-]{6,})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function isYouTubeUrl(url: string): boolean {
  return youTubeVideoId(url) !== null;
}

/** Predictable thumbnail URL for a video id (maxres; agent falls back to hqdefault). */
export function youTubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

/** A filesystem-safe slug from a URL (host + first path segment). */
export function digestSlug(url: string): string {
  const ytId = youTubeVideoId(url);
  if (ytId) return `youtube-${ytId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64);
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean).slice(0, 2).join("-");
    return `${host}${seg ? `-${seg}` : ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "link";
  } catch {
    return "link";
  }
}

/** YouTube digests are saved as HTML (thumbnail + rich layout); articles as markdown. */
export function digestDocFilename(url: string, dateStr: string): string {
  const ext = isYouTubeUrl(url) ? "html" : "md";
  return `${dateStr}-digest-${digestSlug(url)}.${ext}`;
}

export interface DigestTaskInput {
  url: string;
  note?: string;
  /** Absolute path the agent should write the digest doc to. */
  docPath: string;
}

/** Instruction to read the operator's goals so the digest can assess relevance. */
const APPLICABILITY_STEP =
  "Assess how this applies to the operator's goals: first brain_search \"Solo Founder OS goals\" " +
  "and brain_read the goals/Solo-Founder-OS doc(s) it finds (and GOALS.md) so you know the actual " +
  "targets — the three monetization engines toward $500K ARR, plus other goals (fitness, learning " +
  "Italian, reading the Bible). Then relate the content specifically and honestly: which goal(s) it " +
  "helps and how, or note if it doesn't apply — never force a connection.";

/** The task instructions: fetch → summarize → write a brain doc. */
export function buildDigestTaskDescription(input: DigestTaskInput): string {
  const ytId = youTubeVideoId(input.url);
  if (ytId) return buildYouTubeDigestDescription(input, ytId);

  const lines = [
    `Digest this link for later review and save it to the knowledge base: ${input.url}`,
    "",
    "Steps:",
    "1. Fetch the page content — use hivematrix_browser with mode=read/search, or mode=workflow if it needs a logged-in/rendered page.",
    "2. Write a tight, information-dense summary: a 4-8 sentence overview, then 3-6 key takeaways as bullets.",
    `3. ${APPLICABILITY_STEP}`,
    `4. Save it as a markdown brain doc using write_file at exactly this path: ${input.docPath}`,
    "   The doc must start with a '# <title>' heading, then the summary, then a '## How this applies to me' section, then a 'Source: <url>' line at the end.",
  ];
  if (input.note?.trim()) lines.push(`5. Incorporate this note from the operator: ${input.note.trim()}`);
  lines.push("", "Keep it factual. If the page can't be fetched, say so in the doc rather than inventing content.");
  return lines.join("\n");
}

/** YouTube-specific: a rich, self-contained HTML digest with thumbnail + applicability. */
function buildYouTubeDigestDescription(input: DigestTaskInput, videoId: string): string {
  const thumb = youTubeThumbnailUrl(videoId);
  const lines = [
    `Digest this YouTube video for later review and save a rich HTML summary to the knowledge base: ${input.url}`,
    `Video id: ${videoId}. Thumbnail URL: ${thumb} (if that 404s, use https://img.youtube.com/vi/${videoId}/hqdefault.jpg).`,
    "",
    "Steps:",
    "1. Open the video with hivematrix_browser (mode=read, or mode=workflow if it needs rendering) and capture the SUBSTANCE: the exact title, channel/creator, publish date, and duration; the full video DESCRIPTION; and — most important — the TRANSCRIPT/captions if available (open the transcript panel). The transcript is what makes the summary solid; base the summary on the actual spoken content, not just the title/description.",
    `2. ${APPLICABILITY_STEP}`,
    `3. Write a self-contained, well-structured HTML document (inline styles are fine; no external assets except the thumbnail image) and save it with write_file at exactly this path: ${input.docPath}`,
    "   The HTML must include, in this order:",
    `   - An <h1> with the video title, immediately followed by a clickable <a href="${input.url}">Watch on YouTube ↗</a> link.`,
    `   - The thumbnail wrapped in a link to the video: <a href="${input.url}"><img src="${thumb}" alt="thumbnail" style="max-width:100%;border-radius:8px"></a>.`,
    "   - A meta line: channel · publish date · duration.",
    "   - A detailed multi-paragraph SUMMARY that actually captures the content — the core argument/method/story, the main points in the order presented, notable examples, and any concrete numbers, steps, or frameworks. This should be thorough (several solid paragraphs), not a two-line blurb.",
    "   - A '<h2>Key takeaways</h2>' section with 5-10 substantive bullets.",
    "   - A '<h2>How this applies to me</h2>' section relating the video to HiveMatrix, the Solo Founder OS goals (the monetization engines toward $500K ARR), and other goals (fitness, Italian, Bible) where genuinely relevant — be specific and honest per the applicability step above.",
    `   - A footer '<p>Source: <a href="${input.url}">${input.url}</a></p>'.`,
  ];
  if (input.note?.trim()) lines.push(`4. Incorporate this note from the operator: ${input.note.trim()}`);
  lines.push("", "Keep it factual and grounded in the actual video. If the transcript/description can't be captured, say so in the doc and summarize from what's available rather than inventing content.");
  return lines.join("\n");
}
