"""Flash LLM processor for the Pipecat realtime voice pipeline.

Replaces the direct local-model LLM call (OpenAILLMService) with the daemon's
/flash/turn SSE endpoint. Each voice turn is routed through Flash Lane, giving
the realtime pipeline access to the full Flash context stack: persona
(SOUL/IDENTITY/USER), session history, brain_search, and the tool bridge
(termbee, messagebee, brain_search, …).

SSE event → Pipecat frame mapping:
  token      → TextFrame(delta)          — streamed to TTS sentence-by-sentence
  tool_start / tool_result → (no frame)  — Flash handles execution silently
  escalated  → TextFrame(ESCALATION_ACK) — spoken notice that a task was kicked off
  done       → LLMFullResponseEndFrame   — signals TTS to finish flushing

Session continuity: the session_id returned in `done` events is stored and
sent on the next turn so Flash Lane resumes the same session. One
FlashLLMProcessor instance persists across turns for a WebRTC connection.

Env vars (set by daemon via llm-env.ts / realtime-session.ts):
  HIVE_DAEMON_URL    — daemon base URL (default http://127.0.0.1:3747)
  HIVE_DAEMON_TOKEN  — bearer auth token (from ~/.hivematrix/auth-token)
  HIVE_FLASH_CHANNEL — channel label sent to /flash/turn (default "voice")
  HIVE_FLASH_PEER    — peer label (default "operator")
"""
from __future__ import annotations

import asyncio
import json
import os
import traceback
from typing import Optional

import aiohttp
from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    TextFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

DAEMON_URL = os.environ.get("HIVE_DAEMON_URL", "http://127.0.0.1:3747")
DAEMON_TOKEN = os.environ.get("HIVE_DAEMON_TOKEN", "")
FLASH_CHANNEL = os.environ.get("HIVE_FLASH_CHANNEL", "voice")
FLASH_PEER = os.environ.get("HIVE_FLASH_PEER", "operator")

# Spoken when the turn is escalated to a work package instead of answered inline.
_ESCALATION_ACK = (
    "I've kicked that off as a task. I'll let you know when it's done."
)

# Default request timeout: 3 min wall-clock budget per turn (matches Flash Lane
# config of max 12 tool calls / 3 min; plus a 5 s connection timeout).
_FLASH_TIMEOUT = aiohttp.ClientTimeout(total=180, connect=5)


class FlashLLMProcessor(FrameProcessor):
    """Routes transcribed voice turns through the daemon's /flash/turn SSE.

    Sits between WhisperCppSTT and VoxCPMTTS in the Flash pipeline. Receives
    TranscriptionFrame, calls /flash/turn, and streams TextFrames to TTS.
    No local context aggregation — Flash Lane owns context server-side.
    """

    def __init__(self, session_id: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self._session_id = session_id
        self._active_task: Optional[asyncio.Task] = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            # A new transcription means the user spoke. Cancel any in-flight
            # Flash call (barge-in) before starting the new one.
            if self._active_task and not self._active_task.done():
                self._active_task.cancel()
            self._active_task = asyncio.create_task(
                self._call_flash(frame.text.strip(), direction)
            )
        else:
            await self.push_frame(frame, direction)

    async def _call_flash(self, text: str, direction: FrameDirection) -> None:
        """POST to /flash/turn SSE and stream TextFrames to the TTS downstream."""
        payload: dict = {
            "channel": FLASH_CHANNEL,
            "peer": FLASH_PEER,
            "text": text,
        }
        if self._session_id:
            payload["sessionId"] = self._session_id

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        if DAEMON_TOKEN:
            headers["Authorization"] = f"Bearer {DAEMON_TOKEN}"

        await self.push_frame(LLMFullResponseStartFrame(), direction)
        ended = False
        try:
            async with aiohttp.ClientSession(timeout=_FLASH_TIMEOUT) as session:
                async with session.post(
                    f"{DAEMON_URL}/flash/turn",
                    json=payload,
                    headers=headers,
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        await self.push_frame(
                            TTSSpeakFrame(
                                f"Sorry, the flash endpoint returned an error."
                            ),
                            direction,
                        )
                        return

                    # Read SSE line-by-line. readline() blocks until \n, which
                    # is correct for SSE (each data line ends with \n).
                    while True:
                        raw = await resp.content.readline()
                        if not raw:
                            break  # connection closed
                        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].lstrip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        etype = event.get("type") or event.get("event")

                        if etype == "token":
                            delta = event.get("delta") or event.get("text") or ""
                            if delta:
                                await self.push_frame(TextFrame(delta), direction)

                        elif etype == "done":
                            if event.get("sessionId"):
                                self._session_id = event["sessionId"]
                            ended = True
                            break

                        elif etype == "escalated":
                            await self.push_frame(
                                TextFrame(_ESCALATION_ACK), direction
                            )
                            ended = True
                            break

                        # tool_start / tool_result: Flash Lane handles execution.
                        # No frame emitted here; TTS stays silent during tool calls.

        except asyncio.CancelledError:
            # Barge-in: user spoke again. Clean cancellation — don't push more
            # frames; LLMFullResponseEndFrame is pushed in the finally block so
            # TTS can flush whatever it has buffered.
            pass
        except Exception:
            await self.push_frame(
                TTSSpeakFrame("Sorry, I couldn't reach the flash service right now."),
                direction,
            )
        finally:
            try:
                await self.push_frame(LLMFullResponseEndFrame(), direction)
            except Exception:
                pass
