/**
 * YouTube playlist watcher — pure types + rendering. No new Bee brand (scope
 * wall); this is a watch-and-summarize workflow over the YouTube Data API.
 *
 * "Watch Later" itself is NOT reachable via the API (Google removed it), so the
 * operator saves videos to a normal private/unlisted playlist and points the
 * watcher at that playlist id. Each new item is summarized (transcript-based)
 * into a standalone HTML brain doc with the thumbnail + a link, for review.
 */

export interface PlaylistVideo {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  /** When the item was added to the playlist (ISO). */
  addedAt: string;
  thumbnailUrl: string;
  url: string;
}

/** Items not yet seen, oldest-added first (so docs are written in add order). */
export function newVideos(items: PlaylistVideo[], seen: ReadonlySet<string>): PlaylistVideo[] {
  return items
    .filter((v) => v.videoId && !seen.has(v.videoId))
    .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0));
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
}

/** Deterministic brain-doc filename: dated + title slug + id (collision-proof). */
export function videoDocFilename(video: PlaylistVideo, dateStr: string): string {
  return `${dateStr}-youtube-${slugify(video.title)}-${video.videoId}.html`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderVideoDocInput {
  video: PlaylistVideo;
  /** Model-written summary of the video (from the transcript when available). */
  summary: string;
  /** True when the summary was produced from a real transcript vs. just the description. */
  fromTranscript: boolean;
  generatedAt: string;
}

/** Render a standalone HTML brain doc for one video. Pure + fully escaped. */
export function renderVideoDoc(input: RenderVideoDocInput): string {
  const { video, summary, fromTranscript, generatedAt } = input;
  const title = escapeHtml(video.title);
  const channel = escapeHtml(video.channelTitle);
  const url = escapeHtml(video.url);
  const thumb = escapeHtml(video.thumbnailUrl);
  const source = fromTranscript ? "transcript" : "description (no transcript available)";
  // Preserve paragraph breaks from the summary; escape everything.
  const summaryHtml = summary
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 16px/1.6 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  a { color: #0a58ca; }
  .meta { color: #666; font-size: 0.9rem; }
  .thumb { display: block; max-width: 100%; border-radius: 10px; margin: 1rem 0; }
  .src { color: #888; font-size: 0.8rem; margin-top: 2rem; }
  h1 { font-size: 1.4rem; line-height: 1.3; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">${channel} · added ${escapeHtml(video.addedAt.slice(0, 10))}</p>
  <a href="${url}"><img class="thumb" src="${thumb}" alt="${title} thumbnail"></a>
  <p><a href="${url}">▶ Watch on YouTube</a></p>
  <h2>Summary</h2>
  ${summaryHtml || "<p>(no summary)</p>"}
  <p class="src">Summarized from ${escapeHtml(source)} · generated ${escapeHtml(generatedAt)} · HiveMatrix YouTube watcher</p>
</body>
</html>
`;
}
