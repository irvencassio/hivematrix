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

## Pieces

- `capture.mjs` — screen recorder (ffmpeg/avfoundation)
- `make.mjs` — orchestrator: voiceover (sidecar) → captions (whisper) → Remotion render
- `src/` — Remotion compositions: `TitleCard`, `Narrated` (audio + karaoke captions + screen bg + transitions), `Outro`
- `publish.mjs` — YouTube upload (OAuth)
- sidecar: `script_gen.py` (draft), `synth_cli.py` (voiceover), `word_timings.py` (captions), `yt_meta.py` (metadata)

## YouTube setup (one time)

1. Google Cloud → enable **YouTube Data API v3**.
2. Create an OAuth client ID, type **Desktop app**; download the JSON.
3. Save to `~/.hivematrix/youtube/client_secret.json`. First `publish.mjs` run authorizes in the browser; the token caches for next time.

## Status

Done: render toolchain, cloned-voice narration, whisper captions, screen footage,
transitions + outro + music, multilingual, script-drafting, YouTube upload.
Optional/next: presenter slot (real webcam or HeyGen), analytics loop, daemon
integration so Hive drafts + queues videos.
