/**
 * Upload a video to YouTube (Phase 4, P4.6).
 *
 *   node publish.mjs <video.mp4> --meta out/meta.json [--privacy unlisted|private|public]
 *   node publish.mjs <video.mp4> --title "..." --description "..." --tags "a,b,c"
 *
 * One-time setup (yours — I can't auth as you):
 *   1. Google Cloud console → enable "YouTube Data API v3".
 *   2. Create an OAuth client ID of type "Desktop app"; download the JSON.
 *   3. Save it to ~/.hivematrix/youtube/client_secret.json
 * First run opens a browser to authorize; the token is cached in
 * ~/.hivematrix/youtube/token.json for next time.
 */
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const YT_DIR = join(homedir(), ".hivematrix", "youtube");
const CREDS = join(YT_DIR, "client_secret.json");
const TOKEN = join(YT_DIR, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function getAuth() {
  mkdirSync(YT_DIR, { recursive: true });
  if (!existsSync(CREDS)) {
    console.error(`Missing ${CREDS}\nSet up a Google OAuth "Desktop app" client (YouTube Data API v3) and save its JSON there.`);
    process.exit(1);
  }
  const keys = JSON.parse(readFileSync(CREDS, "utf-8"));
  const { client_id, client_secret, redirect_uris } = keys.installed || keys.web;
  if (existsSync(TOKEN)) {
    const o = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);
    o.setCredentials(JSON.parse(readFileSync(TOKEN, "utf-8")));
    return o;
  }
  const client = await authenticate({ scopes: SCOPES, keyfilePath: CREDS });
  if (client.credentials) writeFileSync(TOKEN, JSON.stringify(client.credentials));
  return client;
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

  const auth = await getAuth();
  const yt = google.youtube({ version: "v3", auth });
  console.log(`→ uploading "${title}" (${privacy})…`);
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description, tags, categoryId: "27" }, // 27 = Education
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    },
    media: { body: createReadStream(video) },
  });
  console.log("✅ https://youtu.be/" + res.data.id);
}

main().catch((e) => { console.error("publish failed:", e?.message || e); process.exit(1); });
