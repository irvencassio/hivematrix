# VoiceBee sidecar

The realtime audio runtime for HiveMatrix live voice (Phase 2, DECISIONS Q12).
Per the VoiceBee design, **this sidecar owns the realtime audio loop** (VAD → STT
→ Hive LLM → TTS → playback); the HiveMatrix daemon stays the **control plane**
(tools + session handoff via `POST /voice/session`).

## Environment

Runs on the **base system Python** (3.14+ — validated; mlx-whisper + Pipecat both
ship 3.14 wheels). The `.venv` is this app's isolated dependency folder, built
from that base Python — not a separate or legacy interpreter.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Requires `ffmpeg` on PATH (whisper decodes audio through it) — `brew install ffmpeg`.

## Smoke test (STT, no mic)

```sh
say -o /tmp/t.aiff "the quick brown fox"
.venv/bin/python smoke_stt.py /tmp/t.aiff      # -> "The quick brown fox"
```

First run downloads the whisper model from Hugging Face; later runs are warm.

## Status

- [x] Python 3.14 base + venv; `mlx-whisper` + `pipecat-ai` install & import
- [x] STT round-trip verified (`smoke_stt.py`)
- [ ] Pipecat pipeline (VAD→STT→LLM→TTS) with WebRTC transport (P2.2)
- [ ] Daemon tool calls + `POST /voice/session` handoff wired (P2.2)
- [ ] Streaming/interruptions, sub-800ms (P2.3)

See `~/_GD/brain/projects/hive/plans/2026-06-16-voice-and-video-persona-strategy.md`.
