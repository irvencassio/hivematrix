"""Realtime voice pipeline — shared SmallWebRTC primitives + a direct-model harness.

Two roles:

1. **Shared primitives** (imported by flash_pipeline.py): `VoxCPMTTS`, `make_vad`,
   and `build_transport` — the Silero-VAD SmallWebRTC transport and cloned/Kokoro
   TTS frame source used by the production Flash Lane pipeline.

2. **Direct-model dev harness** (`build_pipeline` / `build_session` / `answer_offer`,
   CommandSTT + a hardcoded spoken prompt → local LLM → TTS): a daemon-INDEPENDENT
   path for testing the raw WebRTC/STT/TTS loop without /flash/turn. Reached only by
   serve_local.py and `python realtime.py -t webrtc`. The PRODUCT voice path does
   NOT use this — realtime_server.py always builds the Flash pipeline, which owns
   the persona/session/tool context and its own system prompt. Keep the two prompts
   from diverging in intent: this one exists purely for isolated pipeline testing.

The desktop CLI (talk.py / live.py) is a separate zero-dependency local path; all
three reuse stt.py / tts.py / the cloned voice.
"""
import asyncio
import os
import tempfile
import traceback
import uuid
import wave

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import TranscriptionFrame, TTSAudioRawFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.settings import STTSettings, TTSSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.services.tts_service import TTSService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.utils.time import time_now_iso8601

from stt import backend_label, transcribe
from tts import synthesize, VOXCPM_MODEL

# Spoken-style system prompt (mirrors llm.py): short, no markdown — goes to TTS.
_APP_VERSION = os.environ.get("HIVE_APP_VERSION", "")
_VERSION_LINE = f" The current HiveMatrix app version is {_APP_VERSION}." if _APP_VERSION else ""
SYSTEM_PROMPT = (
    "You are the user's voice assistant speaking aloud. Reply in one or two short, "
    "natural spoken sentences, and make the FIRST sentence brief so it can be "
    "spoken immediately. No markdown, no lists, no emojis."
    + _VERSION_LINE
)

# Local model — same env contract as llm.py, populated by the daemon from the
# operator's Qwen profile (src/lib/voice/llm-env.ts).
LLM_BASE_URL = os.environ.get("HIVE_LLM_BASE_URL", "http://localhost:1234/v1")
LLM_MODEL = os.environ.get("HIVE_LLM_MODEL", "qwen/qwen3.6-27b")
LLM_API_KEY = os.environ.get("HIVE_LLM_API_KEY", "local")

STT_RATE = int(os.environ.get("HIVE_STT_SAMPLE_RATE", "16000"))
TTS_RATE = 24000   # VoxCPM2 output rate (frames are also self-describing)


class CommandSTT(SegmentedSTTService):
    """Batch STT per VAD-segmented utterance via the configured local command. The base
    buffers audio between VAD start/stop and hands us the whole utterance."""

    def __init__(self, **kwargs):
        super().__init__(
            sample_rate=STT_RATE,
            settings=STTSettings(model=backend_label(), language="en"),
            **kwargs,
        )

    def can_generate_metrics(self) -> bool:
        return False

    async def run_stt(self, audio: bytes):
        path = os.path.join(tempfile.gettempdir(), f"rt-stt-{uuid.uuid4().hex}.wav")
        with open(path, "wb") as w:
            w.write(audio)
        try:
            text = await asyncio.to_thread(transcribe, path)
        except Exception:
            traceback.print_exc()
            text = ""
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        yield TranscriptionFrame(text, "", time_now_iso8601()) if text else None


class VoxCPMTTS(TTSService):
    """Cloned-voice TTS (VoxCPM2 + operator profile + 15% pace) as a frame source.
    Synthesis is batch-per-sentence; we slice the WAV into ~20 ms frames so
    playback streams and Pipecat can cut it off cleanly on barge-in."""

    def __init__(self, quality: str = "fast", **kwargs):
        super().__init__(
            sample_rate=TTS_RATE,
            settings=TTSSettings(model=VOXCPM_MODEL, voice="cloned", language="en"),
            **kwargs,
        )
        self._quality = quality

    def can_generate_metrics(self) -> bool:
        return False

    async def run_tts(self, text: str, context_id: str):
        path = os.path.join(tempfile.gettempdir(), f"rt-tts-{uuid.uuid4().hex}.wav")
        try:
            await asyncio.to_thread(synthesize, text, path, None, TTS_RATE, None, None, self._quality)
            with wave.open(path, "rb") as w:
                rate = w.getframerate()
                pcm = w.readframes(w.getnframes())
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        chunk = int(rate * 0.02) * 2  # 20 ms of s16 mono
        for i in range(0, len(pcm), chunk):
            yield TTSAudioRawFrame(pcm[i:i + chunk], rate, 1, context_id=context_id)


def make_vad() -> SileroVADAnalyzer:
    """Silero VAD tuned for the MacBook mic over WebRTC. The default
    min_volume=0.6 gates out anything below 0.6 normalized, but the built-in mic
    peaks around ~0.18 — so speech never reached the model. Drop min_volume and
    soften confidence so real (quiet) speech is detected; the model still does the
    actual speech/non-speech decision."""
    return SileroVADAnalyzer(params=VADParams(
        confidence=0.4, start_secs=0.2, stop_secs=0.8, min_volume=0.0,
    ))


def build_transport(connection: SmallWebRTCConnection) -> SmallWebRTCTransport:
    """SmallWebRTC transport with audio in/out + Silero VAD (turn-taking)."""
    params = TransportParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        vad_analyzer=make_vad(),
    )
    return SmallWebRTCTransport(webrtc_connection=connection, params=params)


def build_pipeline(transport: SmallWebRTCTransport, tts_quality: str = "fast"):
    """Assemble the realtime pipeline + task. Returns (task, runner)."""
    stt = CommandSTT()
    llm = OpenAILLMService(model=LLM_MODEL, base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    tts = VoxCPMTTS(quality=tts_quality)

    context = LLMContext([{"role": "system", "content": SYSTEM_PROMPT}])
    # Pipecat 1.3: the USER aggregator owns VAD (builds a VADController from this),
    # which drives turn detection + STT segmentation. The transport's vad_analyzer
    # is not what fires user-speech frames in this version.
    agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=make_vad()),
    )

    pipeline = Pipeline([
        transport.input(),
        stt,
        agg.user(),
        llm,
        tts,
        transport.output(),
        agg.assistant(),
    ])
    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))
    return task, PipelineRunner(handle_sigint=False)


GREETING = "Hi, I'm your local assistant. How can I help?"


async def build_session(transport: SmallWebRTCTransport, tts_quality: str = "fast"):
    """Build the pipeline on a transport and wire a greeting on connect. Returns
    (task, runner); the caller decides whether to await runner.run (runner path)
    or fire it as a background task (request-handler path)."""
    task, runner = build_pipeline(transport, tts_quality=tts_quality)

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _client):
        await task.queue_frames([TTSSpeakFrame(GREETING)])

    return task, runner


async def answer_offer(offer: dict, ice_servers=None, tts_quality: str = "fast") -> dict:
    """Accept a client's WebRTC SDP offer, start the pipeline, and return the SDP
    answer. `offer` = {"sdp": ..., "type": "offer"}. `ice_servers` is a list of
    STUN/TURN URLs (Cloudflare) for remote; None = LAN-only. The daemon calls
    this and relays the returned answer back to the iOS client."""
    connection = SmallWebRTCConnection(ice_servers=ice_servers or [])
    await connection.initialize(sdp=offer["sdp"], type=offer["type"])
    transport = build_transport(connection)
    task, runner = build_pipeline(transport, tts_quality=tts_quality)

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _conn):
        # Greet on connect: proves the TTS→WebRTC output path (and that the
        # pipeline source isn't RTVI-gated) independently of mic input.
        await task.queue_frames([TTSSpeakFrame("Hi, I'm your local assistant. How can I help?")])

    asyncio.create_task(runner.run(task))  # pipeline runs until the peer disconnects
    answer = connection.get_answer()  # sync — returns the prepared SDP answer dict
    return {"sdp": answer["sdp"], "type": answer["type"]}


# --- Pipecat dev runner entrypoint -------------------------------------------
# `python realtime.py -t webrtc` serves Pipecat's PREBUILT SmallWebRTC web client
# (known-good mic capture + data channel) and handles signaling; we only build +
# run the pipeline. This is the P5.1 validation path; the daemon uses
# answer_offer() directly in P5.2.
async def bot(runner_args):
    from pipecat.runner.utils import create_transport
    transport = await create_transport(runner_args, {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True, audio_out_enabled=True, vad_analyzer=make_vad(),
        ),
    })
    task, runner = build_pipeline(transport)

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _client):
        await task.queue_frames([TTSSpeakFrame("Hi, I'm your local assistant. How can I help?")])

    await runner.run(task)


if __name__ == "__main__":
    from pipecat.runner.run import main
    main()
