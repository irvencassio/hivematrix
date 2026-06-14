/**
 * YouTube Data API v3 client — playlistItems.list. Read-only, API-key auth.
 * The mapping is pure (testable); the fetch wrapper degrades to a typed error.
 */

import type { PlaylistVideo } from "./contracts";

const API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems";

interface RawThumb { url?: string }
interface RawItem {
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    videoOwnerChannelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, RawThumb | undefined>;
    resourceId?: { videoId?: string };
  };
  contentDetails?: { videoId?: string };
}

/** Map one API item to a PlaylistVideo, or null if it lacks a video id. */
export function mapPlaylistItem(raw: RawItem): PlaylistVideo | null {
  const sn = raw?.snippet;
  const videoId = sn?.resourceId?.videoId ?? raw?.contentDetails?.videoId;
  if (!sn || typeof videoId !== "string" || !videoId) return null;
  const th = sn.thumbnails ?? {};
  const best = th.maxres ?? th.standard ?? th.high ?? th.medium ?? th.default;
  return {
    videoId,
    title: String(sn.title ?? "(untitled)"),
    description: String(sn.description ?? ""),
    channelTitle: String(sn.videoOwnerChannelTitle ?? sn.channelTitle ?? ""),
    addedAt: String(sn.publishedAt ?? new Date(0).toISOString()),
    thumbnailUrl: String(best?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export type FetchPlaylistResult =
  | { ok: true; videos: PlaylistVideo[] }
  | { ok: false; status: number; error: string };

export async function fetchPlaylistItems(opts: {
  apiKey: string;
  playlistId: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<FetchPlaylistResult> {
  const url =
    `${API_BASE}?part=snippet,contentDetails&maxResults=${opts.maxResults ?? 50}` +
    `&playlistId=${encodeURIComponent(opts.playlistId)}&key=${encodeURIComponent(opts.apiKey)}`;
  try {
    const res = await fetch(url, { signal: opts.signal ?? AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: (body.slice(0, 300) || res.statusText) };
    }
    const data = (await res.json()) as { items?: RawItem[] };
    const videos = (data.items ?? []).map(mapPlaylistItem).filter((v): v is PlaylistVideo => v !== null);
    return { ok: true, videos };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
