/**
 * Compare video performance by presentation kind (P4.8).
 *
 *   node analytics.mjs
 *
 * Reads the upload ledger (written by publish.mjs --kind), fetches each video's
 * public statistics from the YouTube Data API, and prints a per-kind comparison
 * (faceless vs screen vs presenter vs avatar) so we keep only the styles that
 * actually earn views/engagement. Engagement here = views/likes/comments;
 * watch-time RETENTION (audienceWatchRatio) is the next layer and needs the
 * YouTube Analytics API (SCOPE_ANALYTICS) — see the note at the end.
 *
 * Needs read access; the first run re-authorizes in the browser if the cached
 * token only had upload scope.
 */
import { google } from "googleapis";
import { getAuth, SCOPE_READONLY } from "./yt-auth.mjs";
import { readLedger, summarizeByKind } from "./yt-ledger.mjs";

/** Fetch statistics for up to 50 ids/call; returns Map<id, {views,likes,comments}>. */
async function fetchStats(yt, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ["statistics"], id: batch });
    for (const item of res.data.items ?? []) {
      const s = item.statistics ?? {};
      out.set(item.id, {
        views: Number(s.viewCount) || 0,
        likes: Number(s.likeCount) || 0,
        comments: Number(s.commentCount) || 0,
      });
    }
  }
  return out;
}

function printTable(rows) {
  if (!rows.length) { console.log("(no data)"); return; }
  const cols = ["kind", "count", "avgViews", "avgLikes", "avgComments", "likeRate", "commentRate"];
  const head = cols.map((c) => c.padEnd(12)).join("");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(12)).join(""));
}

async function main() {
  const ledger = readLedger();
  if (!ledger.length) {
    console.error("No uploads logged yet. Publish with: node publish.mjs <v.mp4> --title .. --kind presenter");
    process.exit(1);
  }
  const auth = await getAuth([SCOPE_READONLY]);
  const yt = google.youtube({ version: "v3", auth });

  const ids = ledger.map((e) => e.id).filter(Boolean);
  console.log(`→ fetching stats for ${ids.length} logged upload(s)…`);
  const stats = await fetchStats(yt, ids);

  const videos = ledger
    .filter((e) => stats.has(e.id))
    .map((e) => ({ kind: e.kind, stats: stats.get(e.id) }));
  const missing = ledger.length - videos.length;

  console.log(`\nPer-kind comparison (${videos.length} video(s)${missing ? `, ${missing} not found/private` : ""}):\n`);
  printTable(summarizeByKind(videos));
  console.log("\nlikeRate/commentRate are per-100-views. Retention (watch %) needs the");
  console.log("YouTube Analytics API — wire SCOPE_ANALYTICS + reports.query next.");
}

main().catch((e) => { console.error("analytics failed:", e?.message || e); process.exit(1); });
