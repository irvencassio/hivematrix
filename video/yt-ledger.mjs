/**
 * Upload ledger + analytics aggregation for the video factory (P4.8).
 *
 * publish.mjs appends one entry per upload (id, title, kind, when); analytics.mjs
 * reads the ledger, fetches each video's stats, and summarizeByKind() rolls them
 * up so we can compare faceless vs screen vs presenter vs avatar. The kind label
 * is the whole point — without it there's nothing to compare — so it's recorded
 * at upload time. summarizeByKind is pure (no I/O) and unit-tested.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { YT_DIR, LEDGER } from "./yt-paths.mjs";

/** The presentation styles we compare. "faceless" = narration over bg/screen. */
export const KNOWN_KINDS = ["faceless", "screen", "presenter", "avatar", "agent-avatar"];

/** Coerce an arbitrary --kind into a known label (default "faceless"). */
export function normalizeKind(k) {
  const v = String(k ?? "").trim().toLowerCase();
  return KNOWN_KINDS.includes(v) ? v : "faceless";
}

export function readLedger() {
  try {
    const data = JSON.parse(readFileSync(LEDGER, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Append an upload record; returns the full ledger. */
export function appendUpload(entry) {
  mkdirSync(YT_DIR, { recursive: true });
  const ledger = readLedger();
  ledger.push(entry);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  return ledger;
}

const round = (n, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };

/**
 * Roll up per-video stats into a per-kind comparison. Input: array of
 * { kind, stats: { views, likes, comments } }. Output: array of per-kind rows
 * sorted by avgViews desc, each { kind, count, avgViews, avgLikes, avgComments,
 * likeRate, commentRate } where rates are per-100-views engagement.
 */
export function summarizeByKind(videos) {
  const groups = new Map();
  for (const v of videos) {
    const kind = normalizeKind(v.kind);
    const s = v.stats ?? {};
    const g = groups.get(kind) ?? { kind, count: 0, views: 0, likes: 0, comments: 0 };
    g.count += 1;
    g.views += Number(s.views) || 0;
    g.likes += Number(s.likes) || 0;
    g.comments += Number(s.comments) || 0;
    groups.set(kind, g);
  }
  return [...groups.values()]
    .map((g) => ({
      kind: g.kind,
      count: g.count,
      avgViews: round(g.views / g.count),
      avgLikes: round(g.likes / g.count),
      avgComments: round(g.comments / g.count),
      likeRate: g.views ? round((g.likes / g.views) * 100, 2) : 0,
      commentRate: g.views ? round((g.comments / g.views) * 100, 2) : 0,
    }))
    .sort((a, b) => b.avgViews - a.avgViews);
}
