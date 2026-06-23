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
 *   node heygen.mjs --list-agent-styles [--tag news]
 *   node heygen.mjs --agent --script script.txt [--style <id>] [--orientation landscape] out.mp4
 *   node heygen.mjs --agent-prompt "Create a portal-style market update" --agent out.mp4
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

function nonBlank(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildVideoAgentPrompt({ agentPrompt, prompt, scriptText, creativeBrief } = {}) {
  const explicit = nonBlank(agentPrompt) || nonBlank(prompt);
  if (explicit) return explicit;

  const brief = nonBlank(creativeBrief);
  const script = nonBlank(scriptText);
  if (!brief && !script) throw new Error("Video Agent prompt requires --agent-prompt, --text, --script, or --creative-brief");

  const parts = [
    "Create a polished presenter video in HeyGen's native creative style.",
    "Use confident pacing, clean visuals, animated text cards, varied scene layouts, smooth transitions, and a portal-quality edit.",
    "Add short section cards for key ideas and end with a crisp closing CTA when appropriate.",
  ];
  if (brief) parts.push(`Creative brief:\n${brief}`);
  if (script) parts.push(`Script:\n${script}`);
  return parts.join("\n\n");
}

export function buildVideoAgentPayload(options = {}) {
  const payload = {
    prompt: buildVideoAgentPrompt(options),
  };

  const avatarId = nonBlank(options.avatarId || options.avatar_id);
  const voiceId = nonBlank(options.voiceId || options.voice_id);
  const styleId = nonBlank(options.styleId || options.style_id || options.style);
  const orientation = nonBlank(options.orientation);
  const callbackUrl = nonBlank(options.callbackUrl || options.callback_url);
  const callbackId = nonBlank(options.callbackId || options.callback_id);
  const files = Array.isArray(options.files)
    ? options.files.filter((file) => typeof file === "string" ? file.trim() : file)
    : undefined;

  if (avatarId) payload.avatar_id = avatarId;
  if (voiceId) payload.voice_id = voiceId;
  if (styleId) payload.style_id = styleId;
  if (orientation) payload.orientation = orientation;
  if (files?.length) payload.files = files;
  if (callbackUrl) payload.callback_url = callbackUrl;
  if (callbackId) payload.callback_id = callbackId;
  return payload;
}

export function buildVideoAgentStylesPath({ tag, limit, token } = {}) {
  const params = new URLSearchParams();
  const cleanTag = nonBlank(tag);
  const cleanToken = nonBlank(token);
  if (cleanTag) params.set("tag", cleanTag);
  if (limit !== undefined && limit !== null && `${limit}`.trim()) params.set("limit", `${limit}`.trim());
  if (cleanToken) params.set("token", cleanToken);
  const query = params.toString();
  return `/v3/video-agents/styles${query ? `?${query}` : ""}`;
}

export function extractVideoAgentSession(response) {
  const data = response?.data ?? response ?? {};
  const sessionId = data.session_id || data.sessionId;
  if (!sessionId) throw new Error(`No session_id in response: ${JSON.stringify(response)}`);
  return {
    sessionId,
    status: data.status,
    videoId: data.video_id || data.videoId,
  };
}

export function extractCompletedVideoUrl(response) {
  const data = response?.data ?? response ?? {};
  if (data.status === "failed") {
    const error = data.failure_message || data.error?.message || data.error || data.message || data;
    throw new Error(`HeyGen Video Agent render failed: ${typeof error === "string" ? error : JSON.stringify(error)}`);
  }
  if (data.status === "completed" && data.video_url) return data.video_url;
  return null;
}

export async function listVideoAgentStyles({ tag, limit, token, key } = {}) {
  const j = await hg(buildVideoAgentStylesPath({ tag, limit, token }), { key });
  return j?.data?.styles ?? j?.data ?? [];
}

export async function createVideoAgentSession(options = {}) {
  const j = await hg("/v3/video-agents", {
    method: "POST",
    key: options.key,
    body: buildVideoAgentPayload(options),
  });
  return extractVideoAgentSession(j);
}

export async function waitForVideoAgent(sessionId, { pollSeconds = 600, key } = {}) {
  const deadline = Date.now() + pollSeconds * 1000;
  let lastAgentStatus = "";
  let lastVideoStatus = "";
  let videoId;

  while (Date.now() < deadline) {
    if (!videoId) {
      const j = await hg(`/v3/video-agents/${encodeURIComponent(sessionId)}`, { key });
      const data = j?.data ?? {};
      if (data.status && data.status !== lastAgentStatus) {
        lastAgentStatus = data.status;
        process.stderr.write(`  [heygen-agent] session: ${data.status}\n`);
      }
      if (data.status === "failed") throw new Error(`HeyGen Video Agent session failed: ${JSON.stringify(data.error || data)}`);
      videoId = data.video_id || data.videoId;
    }

    if (videoId) {
      const j = await hg(`/v3/videos/${encodeURIComponent(videoId)}`, { key });
      const data = j?.data ?? {};
      if (data.status && data.status !== lastVideoStatus) {
        lastVideoStatus = data.status;
        process.stderr.write(`  [heygen-agent] video: ${data.status}\n`);
      }
      const url = extractCompletedVideoUrl(j);
      if (url) return url;
    }

    await sleep(5000);
  }
  throw new Error(`HeyGen Video Agent timed out after ${pollSeconds}s (session_id ${sessionId}${videoId ? `, video_id ${videoId}` : ""})`);
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
export async function generateAvatarVideo({ avatarId, avatarStyle = "normal", voice, width = 1920, height = 1080, key }) {
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
export async function makeAvatarVideo({ scriptText, audioPath, avatarId, voiceId, avatarStyle, speed, width, height, outPath, pollSeconds, key }) {
  let voice;
  if (audioPath) {
    process.stderr.write(`  [heygen] uploading audio asset ${audioPath}…\n`);
    const assetId = await uploadAudioAsset(audioPath, key);
    voice = { type: "audio", audio_asset_id: assetId };
  } else {
    if (!voiceId) throw new Error("--voice <voice_id> is required for the text→speech path (or pass --audio)");
    voice = { type: "text", input_text: scriptText, voice_id: voiceId };
    // HeyGen TTS tempo: 1.0 = native, <1 slower, >1 faster (range ~0.5–1.5).
    if (speed && speed !== 1) voice.speed = speed;
  }
  process.stderr.write(`  [heygen] generating (avatar ${avatarId})…\n`);
  const videoId = await generateAvatarVideo({ avatarId, avatarStyle, voice, width, height, key });
  const url = await waitForVideo(videoId, { pollSeconds, key });
  process.stderr.write(`  [heygen] downloading → ${outPath}\n`);
  return download(url, outPath);
}

/** Full one-shot: prompt/script -> Video Agent render -> MP4 on disk. */
export async function makeVideoAgentVideo(options = {}) {
  process.stderr.write("  [heygen-agent] creating video agent session...\n");
  const session = await createVideoAgentSession(options);
  const url = await waitForVideoAgent(session.sessionId, { pollSeconds: options.pollSeconds, key: options.key });
  const outPath = options.outPath || "heygen-agent-out.mp4";
  process.stderr.write(`  [heygen-agent] downloading -> ${outPath}\n`);
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
  if (has("--list-agent-styles")) {
    const styles = await listVideoAgentStyles({
      tag: flag("--tag"),
      limit: flag("--limit") ? parseInt(flag("--limit"), 10) : undefined,
      token: flag("--token"),
    });
    const rows = Array.isArray(styles) ? styles : styles?.styles ?? [];
    console.log(`VIDEO AGENT STYLES (${rows.length}):`);
    for (const s of rows) console.log(`  ${s.style_id || s.id}\t${s.name || s.title || ""}\t${Array.isArray(s.tags) ? s.tags.join(",") : s.tag || ""}`);
    if (!Array.isArray(styles) && styles?.token) console.log(`NEXT TOKEN: ${styles.token}`);
    return;
  }

  const scriptFile = flag("--script");
  const text = flag("--text");
  const audioPath = flag("--audio");
  const avatarId = flag("--avatar");
  const voiceId = flag("--voice");
  const outPath = process.argv.find((a, i) => i >= 2 && a.endsWith(".mp4") && process.argv[i - 1] !== "--avatar") || "heygen-out.mp4";

  const readScriptText = () => {
    let scriptText = text;
    if (!scriptText && scriptFile) scriptText = readFileSync(scriptFile, "utf-8").trim();
    return scriptText;
  };

  if (has("--agent")) {
    const scriptText = readScriptText();
    const out = await makeVideoAgentVideo({
      agentPrompt: flag("--agent-prompt"),
      scriptText,
      creativeBrief: flag("--creative-brief"),
      avatarId,
      voiceId,
      styleId: flag("--style"),
      orientation: flag("--orientation"),
      outPath,
      pollSeconds: parseInt(flag("--poll-seconds", "600"), 10),
    });
    console.log(out);
    return;
  }

  if (!avatarId) { console.error("error: --avatar <avatar_id> is required (run --list-avatars to find it)"); process.exit(1); }
  const scriptText = readScriptText();
  if (!audioPath && !scriptText) { console.error("error: provide --script <file>, --text \"...\", or --audio <wav>"); process.exit(1); }

  const out = await makeAvatarVideo({
    scriptText, audioPath, avatarId, voiceId,
    avatarStyle: flag("--avatar-style", "normal"),
    speed: flag("--speed") ? parseFloat(flag("--speed")) : undefined,
    width: parseInt(flag("--width", "1920"), 10),
    height: parseInt(flag("--height", "1080"), 10),
    outPath, pollSeconds: parseInt(flag("--poll-seconds", "600"), 10),
  });
  console.log(out);
}

// Run only as a CLI (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
