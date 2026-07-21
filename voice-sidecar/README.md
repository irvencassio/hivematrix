# Voice Lane sidecar

The realtime audio runtime for HiveMatrix live voice (Phase 2, DECISIONS Q12).
Per the Voice Lane design, **this sidecar owns the realtime audio loop** (VAD → STT
→ Hive LLM → TTS → playback); the HiveMatrix daemon stays the **control plane**
(tools + session handoff via `POST /voice/session`).

## Environment

Runs on the **base system Python** (3.14+). The `.venv` is this app's isolated
dependency folder, built from that base Python — not a separate or legacy
interpreter.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

STT is provided by a local command. Set `HIVE_STT_COMMAND` to a command that
prints transcript text to stdout. HiveMatrix appends the audio path unless the
command includes an `{audio}` placeholder.

## Smoke test (STT, no mic)

```sh
export HIVE_STT_COMMAND='your-transcriber {audio}'
say -o /tmp/t.aiff "the quick brown fox"
.venv/bin/python smoke_stt.py /tmp/t.aiff
```

The exact transcript depends on the configured backend.

## Turn loop (headless, no mic)

The single-exchange loop (audio→STT→LLM→TTS→audio) is built as composable modules
— `stt.py`, `tts.py`, `llm.py`, `turn.py` — and proven end-to-end without a mic or
live model:

```sh
.venv/bin/python test_turn.py    # stubbed command STT + real TTS, stubbed LLM
```

> **⚠️ The LLM path described below is RETIRED (0.1.176, 2026-07-11).**
> This sidecar's **STT (whisper) and TTS (Kokoro) are live and ship in the app** —
> the daemon spawns `turn_server.py` / `realtime_server.py` for them. What is dead
> is the *local LLM* leg: voice now routes through the Flash lane end to end, and
> `src/lib/voice/llm-env.ts` no longer exports `HIVE_LLM_*`. With nothing setting
> those vars, `llm.py` / `realtime.py` fall back to hardcoded
> `http://localhost:1234/v1` + `qwen/qwen3.6-27b` — a server that is not running
> and a model that is not installed. Nothing the daemon calls reaches `LocalLLM`,
> but it has not been pruned. Everything from here to the end of this section is
> kept as a historical record of that retired path, not as setup instructions.

Defaults targeted the operator's local server (LM Studio, `qwen/qwen3.6-27b` at
`localhost:1234/v1`); overridden with `HIVE_LLM_BASE_URL` / `HIVE_LLM_MODEL`.

**Validated flow (historical):** "capital of France?" → STT → Qwen 3.6 27B →
*"The capital of France is Paris."* → WAV out.

### Latency (P2.3 — historical, retired local-LLM path)

Qwen 3.6 is a reasoning model. With thinking **ON** (LM Studio default) a turn is
~13s — non-viable. The `enable_thinking:false` API flag is *not* honored by the
current LM Studio build, so **reasoning must be turned off in LM Studio's model
settings** (takes effect immediately, no restart).

Reasoning **OFF**, measured blocking turn (M-series, 128 GB):

| stage | time |
|---|---|
| STT (configured command) | backend-dependent |
| LLM (Qwen 3.6 27B) | 0.98s |
| TTS (`say`) | 0.83s |
| **total** | **2.30s** |

**Streaming** (`streaming.py` + `stream_turn.py`): the LLM is streamed and TTS
starts on the first sentence (eager clause-cut for the opener), so audio begins
before the full reply is done. Headless proof (`test_streaming.py`): TTFA < total.
Real multi-sentence turn vs Qwen 27B: **TTFA ~3.0s, total ~4.0s** — first audio
plays while sentence two is still generating. Short single-sentence replies are
~2.3s.

The remaining TTFA is the 27B generating its first sentence (model speed, not
code). Lower it with a faster voice-lane model or more aggressive (choppier)
first-chunk cuts. The last piece — VAD + barge-in + WebRTC transport (the Pipecat
realtime wrapper) and the iOS/Mac mic UIs — needs a device to validate.

## Talk to it (Mac mic demo)

```sh
.venv/bin/python talk.py
```

Push-to-talk: Enter to start, speak, Enter to stop — it transcribes, asks Qwen,
and speaks the reply, looping for a real conversation. First run, macOS prompts
the terminal for **Microphone** access — grant it. Needs LM Studio serving
`qwen/qwen3.6-27b` on `:1234` with **reasoning OFF**. This is the fastest way to
actually try the assistant (no iOS / WebRTC).

## The voice

One voice: **Kokoro-82M** (`mlx-community/Kokoro-82M-bf16`) via mlx-audio — a fast,
natural, FIXED voice (~0.1s/reply once warm). Everything speaks through the
`synthesize()` seam in `tts.py`; there is no per-caller voice choice. Set the voice
with `HIVE_KOKORO_VOICE` (default `af_heart`; e.g. `am_michael`, `bf_emma`).

macOS `say` is an emergency last resort only — it runs if Kokoro is unavailable so a
turn is never silent, and the headless tests force it with `HIVE_TTS_ENGINE=say` so
they load no model. It is not a selectable voice.

## Status

- [x] Python 3.14 base + venv; `pipecat-ai` install & import
- [x] Command-backed STT seam (`stt.py` / `smoke_stt.py`)
- [x] Turn loop STT→LLM→TTS, headless test (`turn.py` / `test_turn.py`)
- [x] Streaming turn (`streaming.py` / `stream_turn.py` / `test_streaming.py`)
- [x] Mac mic demo (`talk.py`) — push-to-talk, talk-to-it loop (user validates live)
- [x] Kokoro voice (mlx-audio) behind `synthesize()` — the one Voice Lane voice
- [ ] Pipecat realtime wrapper: VAD + barge-in + WebRTC transport (P2.2 — needs a device to validate)
- [ ] Daemon tool calls + `POST /voice/session` handoff wired into the live loop (P2.2)
- [ ] Streaming/interruptions, sub-800 ms (P2.3)

See `~/_GD/brain/projects/hive/plans/2026-06-16-voice-and-video-persona-strategy.md`.
