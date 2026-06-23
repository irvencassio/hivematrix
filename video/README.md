# HiveMatrix Video Factory

Script → narrated, captioned how-to video — in your cloned voice, fully local
(except optional YouTube upload). Phase 4 of the voice/video persona plan.

## Setup

```sh
cd video && npm install          # Remotion, transitions, googleapis (needs Node 18+; brew node)
```

Uses the Python `voice-sidecar` for voiceover + captions (its `.venv` must exist).
Requires `ffmpeg` on PATH.

## The workflow

```sh
# 1. (optional) draft a script from a topic with the local LLM, then edit it
.../voice-sidecar/.venv/bin/python ../voice-sidecar/script_gen.py \
    --topic "how to add a task in HiveMatrix" --lang en --seconds 30 --out script.txt

# 2. record a screen walkthrough (grant Screen Recording to your terminal once)
node capture.mjs 30 out/screen.mp4

# 3. build the video: script + recording → narrated, captioned MP4
node make.mjs script.txt out/howto.mp4 --screen out/screen.mp4 --title "How to add a task"

# 4. (optional) publish to YouTube with AI-generated metadata
../voice-sidecar/.venv/bin/python ../voice-sidecar/yt_meta.py --script-file script.txt --out out/meta.json
node publish.mjs out/howto.mp4 --meta out/meta.json --privacy unlisted
```

## make.mjs flags

| flag | meaning |
|---|---|
| `--title "..."` | intro/outro/watermark title |
| `--screen <file>` | screen-recording footage as the background (how-tos) |
| `--lang <code>` | narration + captions language (e.g. `it`, `es`, `fr`). Your cloned voice is multilingual. |
| `--music <file>` | background music bed (looped, low volume) |
| `--presenter <file>` | webcam presenter clip as a rounded picture-in-picture (bottom-right, muted, looped). Use a real batch-filmed clip — sparingly. |

## Pieces

- `capture.mjs` — screen recorder (ffmpeg/avfoundation)
- `make.mjs` — orchestrator: voiceover (sidecar) → captions (whisper) → Remotion render
- `src/` — Remotion compositions: `TitleCard`, `Narrated` (audio + karaoke captions + screen bg + presenter PIP + transitions), `Outro`
- `publish.mjs` — YouTube upload (OAuth). `--kind faceless|screen|presenter|avatar` records the style in the upload ledger.
- `analytics.mjs` — per-kind performance comparison (faceless vs screen vs presenter vs avatar) from the ledger + Data API stats
- `yt-auth.mjs` / `yt-ledger.mjs` / `yt-paths.mjs` — shared OAuth (scope-aware re-auth), upload ledger + pure rollup, paths
- sidecar: `script_gen.py` (draft), `synth_cli.py` (voiceover), `word_timings.py` (captions), `yt_meta.py` (metadata)

## YouTube setup (one time)

1. Google Cloud → enable **YouTube Data API v3** (+ **YouTube Analytics API** later for retention).
2. Create an OAuth client ID, type **Desktop app**; download the JSON.
3. Save to `~/.hivematrix/youtube/client_secret.json`. First `publish.mjs` run authorizes in the browser; the token caches for next time. `analytics.mjs` needs read access — if the cached token is upload-only it re-authorizes once.

Compatibility commands from the setup runbook are also available:

```sh
node youtube-auth.mjs
node youtube-upload.mjs out/howto.mp4 \
  --title "HiveMatrix demo" \
  --description "A short HiveMatrix update." \
  --tags "AI,HiveMatrix" \
  --privacy unlisted
```

`youtube-upload.mjs` delegates to `publish.mjs`, so uploads are still written to
the local ledger for later analytics.

## AI news avatar pipeline

The daily AI-news path is:

```sh
# Verify headline/script generation without HeyGen spend or YouTube upload.
node publish-ai-news.mjs --dry-run

# Full run: HN/NewsAPI headlines → presenter script → HeyGen Video Agent → YouTube.
node publish-ai-news.mjs --privacy unlisted
```

`news-script.mjs` works without a news key by reading Hacker News top stories and
filtering for AI terms. If `NEWSAPI_KEY` or `~/.hivematrix/config.json`
`newsapi.apiKey` exists, `--source auto` can use NewsAPI. If `ANTHROPIC_API_KEY`
or `providers.anthropic.apiKey` exists, `--writer auto` asks Claude for the
script; otherwise it writes a deterministic presenter script.

By default, the AI-news runner uses HeyGen Video Agent (`--render-mode agent`)
because that is the API path closest to the native HeyGen portal: HeyGen chooses
scene composition, pacing, transitions, animated text cards, and the overall
style treatment from the prompt. The older direct avatar renderer is still
available when you need predictable talking-head output:

```sh
# Browse portal-like style presets before rendering.
node heygen.mjs --list-agent-styles --tag cinematic

# Creative / portal-like output with a selected style.
node publish-ai-news.mjs \
  --style style_noir_detective \
  --creative-brief "Use bold animated text cards between stories and energetic YouTube pacing." \
  --privacy unlisted

# Old deterministic avatar mode.
node publish-ai-news.mjs --render-mode direct --privacy unlisted
```

Useful controls:

| flag | meaning |
|---|---|
| `--dry-run` | stop after writing script/title/description/tags/headlines |
| `--skip-render` | reuse the date-stamped MP4 already in `video/out` |
| `--skip-upload` | render the avatar MP4 but do not upload |
| `--source hn\|newsapi\|auto` | choose headline source |
| `--writer template\|anthropic\|auto` | choose script writer |
| `--render-mode agent\|direct` | choose portal-like HeyGen Video Agent or direct talking-head avatar render |
| `--style <style_id>` | apply a HeyGen Video Agent style preset |
| `--orientation landscape\|portrait` | choose Video Agent output shape |
| `--creative-brief "..."` | steer text cards, pacing, transitions, and visual treatment |

## HeyGen creative vs direct mode

Use Video Agent mode for the highest-quality creative output:

```sh
node make-avatar.mjs script.txt out/creative.mp4 \
  --mode agent \
  --style style_noir_detective \
  --creative-brief "Make this feel like a native HeyGen portal render with animated section cards, varied scene layouts, and a closing CTA."
```

Use direct mode for exact avatar/script control or cloned-voice lip sync:

```sh
node make-avatar.mjs script.txt out/direct.mp4 --mode direct --avatar <avatar_id> --voice <voice_id>
node make-avatar.mjs script.txt out/cloned.mp4 --mode direct --avatar <avatar_id> --cloned
```

## Measuring what works (P4.8)

Tag each upload with how it was made, then compare:

```
node publish.mjs out/howto.mp4 --title "How to add a task" --kind presenter
node analytics.mjs   # per-kind table: avg views/likes/comments + engagement rates
```

Only kinds logged via `--kind` are comparable. Engagement = views/likes/comments
today; watch-time **retention** is the next layer (YouTube Analytics API). The
creative Video Agent lane logs as `agent-avatar`, while the older direct
talking-head lane logs as `avatar`.

## Status

Done: render toolchain, cloned-voice narration, whisper captions, screen footage,
transitions + outro + music, multilingual, script-drafting, YouTube upload,
presenter PIP (`--presenter`), per-kind analytics (`--kind` + `analytics.mjs`).
Optional/next: HeyGen full-frame avatar layer, retention (Analytics API), daemon
integration so Hive drafts + queues videos.
