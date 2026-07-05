"""Flash Lane realtime voice pipeline.

Replaces the direct local-model LLM with the daemon's /flash/turn endpoint,
giving realtime voice access to the full Flash context stack: persona
(SOUL/IDENTITY/USER), session history, brain_search, and tool bridge.

Pipeline:
  SmallWebRTC mic in
    → Silero VAD (turn-taking + barge-in boundary detection)
    → WhisperCppSTT (local, offline, model stays warm)
    → FlashLLMProcessor (POST /flash/turn SSE; streams token deltas)
    → VoxCPMTTS quality=fast  (Kokoro-82M; ~0.1 s/sentence once warm)
    → SmallWebRTC audio out

Drop-in replacement for realtime.py's build_session / answer_offer API.
Both functions have the same return type (task, runner) and event-handler
convention so realtime_server.py can switch between them with one env flag.
"""
import asyncio
import os
from typing import Optional

from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

# Reuse the VAD factory, TTS service, and transport builder from realtime.py
# so changes to VAD tuning / TTS quality apply uniformly to both pipelines.
from realtime import VoxCPMTTS, build_transport, make_vad  # noqa: F401 (re-exported)
from flash_llm import FlashLLMProcessor
from whisper_stt import WhisperCppSTT

GREETING = "Hi, I'm ready. How can I help?"


def build_flash_pipeline(
    transport,
    session_id: Optional[str] = None,
    tts_quality: str = "fast",
):
    """Assemble the Flash Lane realtime pipeline. Returns (task, runner).

    No LLMContextAggregatorPair — Flash Lane owns context server-side (persona +
    rolling session summary). The explicit VAD processor emits the speech
    boundary frames that SegmentedSTTService needs to run transcription.
    """
    stt = WhisperCppSTT()
    vad = VADProcessor(vad_analyzer=make_vad())
    flash = FlashLLMProcessor(session_id=session_id)
    tts = VoxCPMTTS(quality=tts_quality)

    pipeline = Pipeline([
        transport.input(),
        vad,
        stt,
        flash,
        tts,
        transport.output(),
    ])
    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))
    return task, PipelineRunner(handle_sigint=False)


async def build_flash_session(
    transport,
    session_id: Optional[str] = None,
    tts_quality: str = "fast",
):
    """Build the Flash pipeline and wire a greeting on connect. Returns (task, runner)."""
    task, runner = build_flash_pipeline(
        transport, session_id=session_id, tts_quality=tts_quality
    )

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _client):
        await task.queue_frames([TTSSpeakFrame(GREETING)])

    return task, runner


async def answer_flash_offer(
    offer: dict,
    ice_servers=None,
    session_id: Optional[str] = None,
    tts_quality: str = "fast",
) -> dict:
    """Accept a WebRTC SDP offer, start the Flash pipeline, return the SDP answer.

    Same API as realtime.answer_offer() — the daemon's /voice/rtc/offer handler
    calls this transparently when HIVE_FLASH_ENABLED=1.
    """
    connection = SmallWebRTCConnection(ice_servers=ice_servers or [])
    await connection.initialize(sdp=offer["sdp"], type=offer["type"])
    transport = build_transport(connection)
    task, runner = build_flash_pipeline(
        transport, session_id=session_id, tts_quality=tts_quality
    )

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _conn):
        await task.queue_frames([TTSSpeakFrame(GREETING)])

    asyncio.create_task(runner.run(task))
    answer = connection.get_answer()
    return {"sdp": answer["sdp"], "type": answer["type"]}
