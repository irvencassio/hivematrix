# LongCat Avatar Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-22-longcat-avatar-renderer-design.md`

## Goal

Run a controlled local proof render to determine whether LongCat Avatar 1.5 on this M5 Max can cover the same practical capability as the current HeyGen path:

- Uses HiveMatrix/local cloned voice audio.
- Uses a stable presenter/avatar identity from a reference image.
- Produces an MP4 that can be inspected for lip sync, identity stability, motion quality, artifacts, render time, and operational friction.

This plan does not add production `/video/make` routing.

## Task 1: Prepare proof fixtures

- [ ] RED: Confirm the proof output does not already exist.

```sh
test ! -f ~/.hivematrix/longcat-proof/out/longcat-proof.mp4
```

- [ ] Create proof directories under `~/.hivematrix/longcat-proof`.
- [ ] Reuse existing HiveMatrix avatar assets where possible:
  - Audio source: `video/out/avatar-narration.wav`
  - Existing HeyGen comparison output: `video/out/ai-news-2026-06-22-avatar.mp4`
- [ ] Extract a short normalized proof audio clip:

```sh
ffmpeg -y -i video/out/avatar-narration.wav -t 4 -ar 16000 -ac 1 ~/.hivematrix/longcat-proof/input/proof-audio.wav
```

- [ ] Extract a reference frame from the existing HeyGen avatar output:

```sh
ffmpeg -y -ss 1 -i video/out/ai-news-2026-06-22-avatar.mp4 -frames:v 1 ~/.hivematrix/longcat-proof/input/reference.png
```

- [ ] Verify fixtures:

```sh
ffprobe -v error -show_entries stream=codec_type,duration,width,height -of json ~/.hivematrix/longcat-proof/input/proof-audio.wav ~/.hivematrix/longcat-proof/input/reference.png
```

## Task 2: Set up isolated LongCat MLX runtime

- [ ] RED: Confirm LongCat MLX runner is not already ready:

```sh
test ! -x ~/.hivematrix/longcat-proof/longcat-avatar-mlx/.venv/bin/python
```

- [ ] Ensure Python 3.12 is available. If not, install `python@3.12` with Homebrew.
- [ ] Clone or update the MLX runner:

```sh
git clone https://github.com/xocialize/longcat-avatar-mlx ~/.hivematrix/longcat-proof/longcat-avatar-mlx
```

- [ ] Create the venv with Python 3.12.
- [ ] Install the runner with its parity extras and required media packages:

```sh
~/.hivematrix/longcat-proof/longcat-avatar-mlx/.venv/bin/pip install -e ".[parity]"
~/.hivematrix/longcat-proof/longcat-avatar-mlx/.venv/bin/pip install librosa Pillow imageio imageio-ffmpeg
```

- [ ] GREEN: Verify imports:

```sh
~/.hivematrix/longcat-proof/longcat-avatar-mlx/.venv/bin/python - <<'PY'
import mlx.core as mx
import longcat_video_avatar
print(mx.default_device())
PY
```

## Task 3: Download smallest viable weights

- [ ] RED: Confirm selected weights are absent:

```sh
test ! -f ~/.hivematrix/longcat-proof/weights/pipeline_config.json
```

- [ ] Download `mlx-community/LongCat-Video-Avatar-1.5-q4-dmd-merged` into `~/.hivematrix/longcat-proof/weights`.
- [ ] GREEN: Verify expected weight layout and approximate disk size.

## Task 4: Run tiny proof render

- [ ] RED: Run the render command once and capture any actionable failure in `~/.hivematrix/longcat-proof/out/render.log`.
- [ ] If the runner supports reference image/audio CLI flags, use:

```sh
cd ~/.hivematrix/longcat-proof/longcat-avatar-mlx
.venv/bin/python scripts/run_inference.py \
  --weights ~/.hivematrix/longcat-proof/weights \
  --variant q4-dmd-merged \
  --audio ~/.hivematrix/longcat-proof/input/proof-audio.wav \
  --reference-image ~/.hivematrix/longcat-proof/input/reference.png \
  --num-frames 29 \
  --out ~/.hivematrix/longcat-proof/out/longcat-proof.mp4
```

- [ ] If the exact flag names differ, inspect `scripts/run_inference.py --help` and adapt without changing production HiveMatrix code.
- [ ] GREEN: Verify the output:

```sh
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,width,height,avg_frame_rate -of json ~/.hivematrix/longcat-proof/out/longcat-proof.mp4
```

## Task 5: Compare against HeyGen capability

- [ ] Create frame grabs from LongCat and HeyGen outputs.
- [ ] Compare:
  - Can it use local audio directly?
  - Does it preserve a usable presenter identity?
  - Is lip sync plausible?
  - Are motion/artifacts acceptable?
  - Is render time acceptable for HiveMatrix jobs?
  - Does setup feel robust enough to automate?
- [ ] Write the comparison summary to `~/.hivematrix/longcat-proof/RESULTS.md`.

## Task 6: Final verification

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/scope-wall.mjs`.
- [ ] Review whether the only repo changes are Superpowers docs unless the proof exposed a need for test helper scripts.
