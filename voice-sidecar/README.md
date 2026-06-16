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

## Turn loop (headless, no mic)

The single-exchange loop (audio→STT→LLM→TTS→audio) is built as composable modules
— `stt.py`, `tts.py`, `llm.py`, `turn.py` — and proven end-to-end without a mic or
live model:

```sh
.venv/bin/python test_turn.py    # real STT + real TTS, stubbed LLM
```

Defaults target the operator's local server (LM Studio, `qwen/qwen3.6-27b` at
`localhost:1234/v1`); override with `HIVE_LLM_BASE_URL` / `HIVE_LLM_MODEL`.

**Validated against the real model:** "capital of France?" → STT (large-v3-turbo)
→ Qwen 3.6 27B → *"The capital of France is Paris."* → WAV out.

### Latency (P2.3)

Qwen 3.6 is a reasoning model. With thinking **ON** (LM Studio default) a turn is
~13s — non-viable. The `enable_thinking:false` API flag is *not* honored by the
current LM Studio build, so **reasoning must be turned off in LM Studio's model
settings** (takes effect immediately, no restart).

Reasoning **OFF**, measured blocking turn (M-series, 128 GB):

| stage | time |
|---|---|
| STT (whisper-large-v3-turbo) | 0.49s |
| LLM (Qwen 3.6 27B) | 0.98s |
| TTS (`say`) | 0.83s |
| **total** | **2.30s** |

2.3s blocking is usable but not instant. Sub-second *feel* comes from **streaming**
(start TTS on the LLM's first tokens; stream STT for barge-in) in the Pipecat
realtime wrapper — that's the remaining P2.2/P2.3 work (needs a device to validate).

## Status

- [x] Python 3.14 base + venv; `mlx-whisper` + `pipecat-ai` install & import
- [x] STT round-trip verified (`smoke_stt.py`)
- [x] Turn loop STT→LLM→TTS, headless test (`turn.py` / `test_turn.py`)
- [ ] Pipecat realtime wrapper: VAD + streaming + WebRTC transport (P2.2 — needs a device to validate)
- [ ] Daemon tool calls + `POST /voice/session` handoff wired into the live loop (P2.2)
- [ ] Streaming/interruptions, sub-800 ms (P2.3)

See `~/_GD/brain/projects/hive/plans/2026-06-16-voice-and-video-persona-strategy.md`.
