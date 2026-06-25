"""One Voice Lane turn: audio in → STT → LLM → TTS → audio out.

This is the pure orchestration of a single spoken exchange, decoupled from any
transport. The realtime Pipecat pipeline (pipeline.py) and the headless test
(test_turn.py) both drive it. `respond` is injected (a callable str -> str) so
the LLM can be the real LocalLLM or a stub.
"""
from dataclasses import dataclass
from typing import Callable, Optional

from stt import transcribe
from tts import synthesize


@dataclass
class TurnResult:
    transcript: str
    reply: str
    audio_out: Optional[str]


def run_turn(audio_in: str, respond: Callable[[str], str],
             stt_model: Optional[str] = None) -> TurnResult:
    """Run a single turn. Returns empty transcript/reply for silence."""
    transcript = transcribe(audio_in, model=stt_model)
    if not transcript:
        return TurnResult(transcript="", reply="", audio_out=None)
    reply = respond(transcript)
    audio_out = synthesize(reply) if reply.strip() else None
    return TurnResult(transcript=transcript, reply=reply, audio_out=audio_out)
