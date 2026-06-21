#!/usr/bin/env node
/**
 * HeyGen avatar-presenter client (Job 3) — the talking-head stage of the video
 * factory. Given a script, it renders an avatar video via the HeyGen API and
 * downloads the MP4. Pipeline role: HiveMatrix script → (cloned-voice narration,
 * Job 2) → HeyGen avatar render → YouTube. For the first quality test it uses a
 * HeyGen stock voice (text→speech); the cloned-voice path (feed our own audio as
 * a HeyGen asset) is supported via --audio once the avatar look is approved.
 *
 * Auth: HeyGen API key from ~/.hivematrix/config.json `heygen.apiKey` or env
 * HEYGEN_API_KEY. The key requires a funded HeyGen API balance (pay-as-you-go,
 * $0.05/sec) — generate it at app.heygen.com → Settings → API after adding funds.
 *
 * Usage:
 *   node heygen.mjs --list-avatars                 # discover avatar_id values
 *   node heygen.mjs --list-voices [--match Irv]    # discover voice_id values
 *   node heygen.mjs --script script.txt --avatar <id> --voice <id> [out.mp4]
 *   node heygen.mjs --text "Hello world" --avatar <id> --voice <id> out.mp4
 *   node heygen.mjs --audio narration.wav --avatar <id> out.mp4   # cloned voice
 *     [--width 1280 --height 720 --avatar-style normal --poll-seconds 600]
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const API = "https://api.heygen.com";
const UPLOAD = "https://upload.heygen.com";

function apiKey() {
  if (process.env.HEYGEN_API_KEY) return process.env.HEYGEN_API_KEY.trim();
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const k = cfg?.heygen?.apiKey;
    if (typeof k === "string" && k.trim()) return k.trim();
  } catch { /* no config */ }
  throw new Error(
    "No HeyGen API key. Add it to ~/.hivematrix/config.json as {\"heygen\":{\"apiKey\":\"...\"}} " +
    "or set HEYGEN_API_KEY. Generate the key at app.heygen.com → Settings → API (needs a funded balance).",
  );
}

async function hg(path, { method = "GET", body, key = apiKey() } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "X-Api-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok || json?.error) {
    const msg = json?.error?.message || json?.message || json?.raw || `HTTP ${r.status}`;
    throw new Error(`HeyGen ${path} failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return json;
}

/** Discover avatars (avatar_id) usable in video_inputs.character. */
export async function listAvatars(key) {
  const j = await hg("/v2/avatars", { key });
  const avatars = j?.data?.avatars ?? [];
  const talking = j?.data?.talking_photos ?? [];
  return { avatars, talkingPhotos: talking };
}

/** Discover voices (voice_id) for text→speech. */
export async function listVoices(key) {
  const j = await hg("/v2/voices", { key });
  return j?.data?.voices ?? [];
}

/** Upload a local audio file as a HeyGen asset → asset_id (for the cloned-voice path). */
export async function uploadAudioAsset(path, key = apiKey()) {
  const bytes = readFileSync(path);
  // HeyGen sniffs the bytes and rejects a mismatched header — RIFF WAV is
  // detected as audio/x-wav (not audio/wav), so match that for .wav uploads.
  const contentType = path.endsWith(".mp3") ? "audio/mpeg" : "audio/x-wav";
  const r = await fetch(`${UPLOAD}/v1/asset`, {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": contentType },
    body: bytes,
  });
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(`HeyGen asset upload failed: ${JSON.stringify(j?.error || j)}`);
  return j?.data?.id || j?.data?.asset_id;
}

/**
 * Kick off an avatar video render. `voice` is either {type:"text", input_text,
 * voice_id} (HeyGen TTS) or {type:"audio", audio_asset_id} (our cloned narration).
 * Returns the video_id to poll.
 */
export async function generateAvatarVideo({ avatarId, avatarStyle = "normal", voice, width = 1280, height = 720, key }) {
  const j = await hg("/v2/video/generate", {
    method: "POST",
    key,
    body: {
      video_inputs: [{
        character: { type: "avatar", avatar_id: avatarId, avatar_style: avatarStyle },
        voice,
      }],
      dimension: { width, height },
    },
  });
  const id = j?.data?.video_id;
  if (!id) throw new Error(`No video_id in response: ${JSON.stringify(j)}`);
  return id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until the video is completed (or failed); returns the downloadable video_url. */
export async function waitForVideo(videoId, { pollSeconds = 600, key } = {}) {
  const deadline = Date.now() + pollSeconds * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const j = await hg(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, { key });
    const d = j?.data ?? {};
    if (d.status !== last) { last = d.status; process.stderr.write(`  [heygen] status: ${d.status}\n`); }
    if (d.status === "completed") return d.video_url;
    if (d.status === "failed") throw new Error(`HeyGen render failed: ${JSON.stringify(d.error || d)}`);
    await sleep(5000);
  }
  throw new Error(`HeyGen render timed out after ${pollSeconds}s (video_id ${videoId})`);
}

async function download(url, outPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(outPath, buf);
  return outPath;
}

/** Full one-shot: script/text/audio → rendered MP4 on disk. */
export async function makeAvatarVideo({ scriptText, audioPath, avatarId, voiceId, avatarStyle, width, height, outPath, pollSeconds, key }) {
  let voice;
  if (audioPath) {
    process.stderr.write(`  [heygen] uploading audio asset ${audioPath}…\n`);
    const assetId = await uploadAudioAsset(audioPath, key);
    voice = { type: "audio", audio_asset_id: assetId };
  } else {
    if (!voiceId) throw new Error("--voice <voice_id> is required for the text→speech path (or pass --audio)");
    voice = { type: "text", input_text: scriptText, voice_id: voiceId };
  }
  process.stderr.write(`  [heygen] generating (avatar ${avatarId})…\n`);
  const videoId = await generateAvatarVideo({ avatarId, avatarStyle, voice, width, height, key });
  const url = await waitForVideo(videoId, { pollSeconds, key });
  process.stderr.write(`  [heygen] downloading → ${outPath}\n`);
  return download(url, outPath);
}

// --- CLI ---
function flag(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);

async function main() {
  if (has("--list-avatars")) {
    const { avatars, talkingPhotos } = await listAvatars();
    console.log("AVATARS:");
    for (const a of avatars) console.log(`  ${a.avatar_id}\t${a.avatar_name || a.name || ""}\t(${a.gender || "?"})`);
    if (talkingPhotos.length) {
      console.log("TALKING PHOTOS:");
      for (const t of talkingPhotos) console.log(`  ${t.talking_photo_id || t.id}\t${t.talking_photo_name || t.name || ""}`);
    }
    return;
  }
  if (has("--list-voices")) {
    const voices = await listVoices();
    const m = flag("--match");
    const filtered = m ? voices.filter((v) => JSON.stringify(v).toLowerCase().includes(m.toLowerCase())) : voices;
    console.log(`VOICES (${filtered.length}${m ? ` matching "${m}"` : ""}):`);
    for (const v of filtered.slice(0, 60)) console.log(`  ${v.voice_id}\t${v.name || v.display_name || ""}\t${v.language || ""}\t${v.gender || ""}`);
    return;
  }

  const scriptFile = flag("--script");
  const text = flag("--text");
  const audioPath = flag("--audio");
  const avatarId = flag("--avatar");
  const voiceId = flag("--voice");
  const outPath = process.argv.find((a, i) => i >= 2 && a.endsWith(".mp4") && process.argv[i - 1] !== "--avatar") || "heygen-out.mp4";

  if (!avatarId) { console.error("error: --avatar <avatar_id> is required (run --list-avatars to find it)"); process.exit(1); }
  let scriptText = text;
  if (!scriptText && scriptFile) scriptText = readFileSync(scriptFile, "utf-8").trim();
  if (!audioPath && !scriptText) { console.error("error: provide --script <file>, --text \"...\", or --audio <wav>"); process.exit(1); }

  const out = await makeAvatarVideo({
    scriptText, audioPath, avatarId, voiceId,
    avatarStyle: flag("--avatar-style", "normal"),
    width: parseInt(flag("--width", "1280"), 10),
    height: parseInt(flag("--height", "720"), 10),
    outPath, pollSeconds: parseInt(flag("--poll-seconds", "600"), 10),
  });
  console.log(out);
}

// Run only as a CLI (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
