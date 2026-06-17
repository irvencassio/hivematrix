/**
 * Upload a video to YouTube (Phase 4, P4.6).
 *
 *   node publish.mjs <video.mp4> --meta out/meta.json [--privacy unlisted|private|public]
 *   node publish.mjs <video.mp4> --title "..." --description "..." --tags "a,b,c" [--kind presenter]
 *
 * --kind (faceless|screen|presenter|avatar) records the presentation style in
 * the upload ledger so analytics.mjs can compare them later (P4.8).
 *
 * One-time setup (yours — I can't auth as you):
 *   1. Google Cloud console → enable "YouTube Data API v3".
 *   2. Create an OAuth client ID of type "Desktop app"; download the JSON.
 *   3. Save it to ~/.hivematrix/youtube/client_secret.json
 * First run opens a browser to authorize; the token is cached in
 * ~/.hivematrix/youtube/token.json for next time.
 */
import { google } from "googleapis";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { getAuth, SCOPE_UPLOAD } from "./yt-auth.mjs";
import { appendUpload, normalizeKind } from "./yt-ledger.mjs";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const video = process.argv[2];
  if (!video || video.startsWith("--") || !existsSync(video)) {
    console.error("usage: node publish.mjs <video.mp4> [--meta meta.json | --title .. --description .. --tags a,b] [--privacy unlisted]");
    process.exit(2);
  }

  let title = arg("--title"), description = arg("--description", ""), tags = (arg("--tags", "") || "").split(",").filter(Boolean);
  const metaFile = arg("--meta");
  if (metaFile && existsSync(metaFile)) {
    const m = JSON.parse(readFileSync(metaFile, "utf-8"));
    title = title || m.title;
    description = description || m.description || "";
    if (!tags.length && Array.isArray(m.tags)) tags = m.tags;
  }
  if (!title) { console.error("a --title or --meta with a title is required"); process.exit(2); }
  const privacy = arg("--privacy", "unlisted");
  const kind = normalizeKind(arg("--kind"));

  const auth = await getAuth([SCOPE_UPLOAD]);
  const yt = google.youtube({ version: "v3", auth });
  console.log(`→ uploading "${title}" (${privacy}, kind=${kind})…`);
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description, tags, categoryId: "27" }, // 27 = Education
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    },
    media: { body: createReadStream(video) },
  });
  const id = res.data.id;
  appendUpload({ id, title, kind, privacy, publishedAt: res.data.snippet?.publishedAt ?? null });
  console.log("✅ https://youtu.be/" + id + `  (logged as ${kind})`);
}

main().catch((e) => { console.error("publish failed:", e?.message || e); process.exit(1); });
