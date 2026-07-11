"""Flash Lane realtime voice pipeline.

Replaces the direct local-model LLM with the daemon's /flash/turn endpoint,
giving realtime voice access to the full Flash context stack: persona
(SOUL/IDENTITY/USER), session history, brain_search, and tool bridge.

Pipeline:
  SmallWebRTC mic in
    → Silero VAD (turn-taking + barge-in boundary detection)
    → WhisperCppSTT (local, offline, model stays warm)
    → FlashLLMProcessor (POST /flash/turn SSE; streams token deltas)
    → KokoroTTS  (Kokoro-82M; ~0.1 s/sentence once warm)
    → SmallWebRTC audio out

Drop-in replacement for realtime.py's build_session / answer_offer API.
Both functions have the same return type (task, runner) and event-handler
convention so realtime_server.py can switch between them with one env flag.
"""
import asyncio
import os
from typing import Optional

import aiohttp
from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

# Reuse the VAD factory, TTS service, and transport builder from realtime.py
# so changes to VAD tuning / TTS apply uniformly to both pipelines.
from realtime import KokoroTTS, build_transport, make_vad  # noqa: F401 (re-exported)
from flash_llm import DAEMON_TOKEN, DAEMON_URL, FlashLLMProcessor
from whisper_stt import WhisperCppSTT

GREETING = "Hi, I'm ready. How can I help?"

# Contextual greeting (2026-07-10 "system shows up" spec): on connect, ask the
# daemon's GET /voice/greeting for a short, live-signal greeting (next
# meeting / approvals+review count / most recent loop-closure) instead of the
# static GREETING above. Short, hard timeout — the daemon route itself
# already answers in <1.5s with its own deterministic fallback, so this is a
# second, independent safety net: ANY failure here (network, timeout,
# non-200, bad JSON) just speaks the static GREETING, same as before this
# feature existed.
_GREETING_FETCH_TIMEOUT = aiohttp.ClientTimeout(total=1.5, connect=1.0)


async def _fetch_greeting() -> str:
    headers = {"Authorization": f"Bearer {DAEMON_TOKEN}"} if DAEMON_TOKEN else {}
    try:
        async with aiohttp.ClientSession(timeout=_GREETING_FETCH_TIMEOUT) as session:
            async with session.get(f"{DAEMON_URL}/voice/greeting", headers=headers) as resp:
                if resp.status != 200:
                    return GREETING
                data = await resp.json()
                text = data.get("text") if isinstance(data, dict) else None
                return text.strip() if isinstance(text, str) and text.strip() else GREETING
    except Exception:
        return GREETING


def build_flash_pipeline(
    transport,
    session_id: Optional[str] = None,
):
    """Assemble the Flash Lane realtime pipeline. Returns (task, runner).

    No LLMContextAggregatorPair — Flash Lane owns context server-side (persona +
    rolling session summary). The explicit VAD processor emits the speech
    boundary frames that SegmentedSTTService needs to run transcription.
    """
    stt = WhisperCppSTT()
    vad = VADProcessor(vad_analyzer=make_vad())
    flash = FlashLLMProcessor(session_id=session_id)
    tts = KokoroTTS()

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
):
    """Build the Flash pipeline and wire a greeting on connect. Returns (task, runner)."""
    task, runner = build_flash_pipeline(transport, session_id=session_id)

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _client):
        greeting = await _fetch_greeting()
        await task.queue_frames([TTSSpeakFrame(greeting)])

    return task, runner


async def answer_flash_offer(
    offer: dict,
    ice_servers=None,
    session_id: Optional[str] = None,
) -> dict:
    """Accept a WebRTC SDP offer, start the Flash pipeline, return the SDP answer.

    Same API as realtime.answer_offer() — the daemon's /voice/rtc/offer handler
    calls this transparently when HIVE_FLASH_ENABLED=1.
    """
    connection = SmallWebRTCConnection(ice_servers=ice_servers or [])
    await connection.initialize(sdp=offer["sdp"], type=offer["type"])
    transport = build_transport(connection)
    task, runner = build_flash_pipeline(transport, session_id=session_id)

    @transport.event_handler("on_client_connected")
    async def _greet(_transport, _conn):
        greeting = await _fetch_greeting()
        await task.queue_frames([TTSSpeakFrame(greeting)])

    asyncio.create_task(runner.run(task))
    answer = connection.get_answer()
    return {"sdp": answer["sdp"], "type": answer["type"]}
