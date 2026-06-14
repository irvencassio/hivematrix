/**
 * Best-effort transcript fetch. YouTube has no official transcript API, so this
 * scrapes the watch page for caption tracks and pulls the json3 timedtext.
 * It is intentionally forgiving: ANY failure returns null and the caller falls
 * back to summarizing from the video description. Never throws.
 */

interface Json3 {
  events?: Array<{ segs?: Array<{ utf8?: string }> }>;
}

/** Pure: flatten json3 caption events into one whitespace-collapsed string. */
export function extractTranscriptText(json3: Json3): string {
  return (json3.events ?? [])
    .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: find the best caption track baseUrl from the captionTracks JSON. */
export function pickCaptionTrack(tracks: Array<{ baseUrl?: string; languageCode?: string }>): string | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const en = tracks.find((t) => t.languageCode === "en" || t.languageCode?.startsWith("en"));
  return (en ?? tracks[0])?.baseUrl ?? null;
}

export async function fetchTranscript(videoId: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const watch = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" },
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!watch.ok) return null;
    const html = await watch.text();
    const m = html.match(/"captionTracks":(\[.*?\])/);
    if (!m) return null;
    let tracks: Array<{ baseUrl?: string; languageCode?: string }>;
    try {
      tracks = JSON.parse(m[1]);
    } catch {
      return null;
    }
    const baseUrl = pickCaptionTrack(tracks);
    if (!baseUrl) return null;
    const capRes = await fetch(`${baseUrl}&fmt=json3`, { signal: signal ?? AbortSignal.timeout(15_000) });
    if (!capRes.ok) return null;
    const text = extractTranscriptText((await capRes.json()) as Json3);
    return text || null;
  } catch {
    return null;
  }
}
