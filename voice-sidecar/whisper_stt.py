"""Whisper.cpp STT for the Flash Lane voice pipeline.

Provides WhisperCppSTT — a Pipecat SegmentedSTTService backed by pywhispercpp
(Python bindings for whisper.cpp). The model is loaded once and kept warm across
turns, eliminating per-turn reload overhead. Falls back to the command seam
(HIVE_STT_COMMAND via stt.transcribe) if pywhispercpp is not installed.

Model resolution order:
  1. HIVE_WHISPER_MODEL env var  (absolute path to a ggml .bin OR a model name
     like 'base.en' that pywhispercpp will auto-download)
  2. ~/.hivematrix/models/ggml-whisper-*.bin  (first match sorted desc by name
     — larger name = higher quality tier e.g. large > medium > small > base)
  3. pywhispercpp downloads 'base.en' to ~/.cache/pywhispercpp/
"""
from __future__ import annotations

import asyncio
import glob
import os
import tempfile
import traceback
import uuid
import wave
from typing import Optional

from pipecat.frames.frames import TranscriptionFrame
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.utils.time import time_now_iso8601

STT_RATE = int(os.environ.get("HIVE_STT_SAMPLE_RATE", "16000"))

# Lazy import check — pywhispercpp may not have Python 3.14 wheels on all
# platforms yet. If unavailable, WhisperCppSTT falls back to the command seam.
_PYWHISPERCPP_AVAILABLE = False
try:
    from pywhispercpp.model import Model as _WhisperModel  # type: ignore
    _PYWHISPERCPP_AVAILABLE = True
except ImportError:
    _WhisperModel = None  # type: ignore

_MODELS: dict[str, object] = {}   # model_path → Model, stays warm across turns


def _resolve_model_path() -> str:
    explicit = os.environ.get("HIVE_WHISPER_MODEL")
    if explicit:
        return explicit
    pattern = os.path.expanduser("~/.hivematrix/models/ggml-whisper-*.bin")
    matches = sorted(glob.glob(pattern), reverse=True)
    if matches:
        return matches[0]
    return "base.en"


def _get_model(path: str):
    if path not in _MODELS:
        if not _PYWHISPERCPP_AVAILABLE:
            raise RuntimeError(
                "pywhispercpp is not installed. Either install it "
                "(pip install pywhispercpp) or set HIVE_STT_COMMAND for the "
                "command-seam fallback."
            )
        n_threads = int(os.environ.get("HIVE_WHISPER_THREADS", "4"))
        _MODELS[path] = _WhisperModel(path, n_threads=n_threads)  # type: ignore
    return _MODELS[path]


def transcribe_whisper(audio_path: str, model_path: Optional[str] = None) -> str:
    """Transcribe a WAV file with whisper.cpp (in-process, model stays warm).

    Returns an empty string for silence or inaudible audio. Callers should
    treat an empty result as a silent/no-op turn rather than an error.
    """
    path = model_path or _resolve_model_path()
    model = _get_model(path)
    segments = model.transcribe(audio_path, language="en", no_timestamps=True)  # type: ignore
    return " ".join(s.text.strip() for s in segments if s.text.strip())


class WhisperCppSTT(SegmentedSTTService):
    """In-process whisper.cpp STT via pywhispercpp.

    Keeps the model warm across turns (loaded once on first call). Falls back
    to the HIVE_STT_COMMAND command seam if pywhispercpp is unavailable, so the
    pipeline degrades gracefully while waiting for a Python 3.14 wheel.

    Drop-in replacement for CommandSTT in realtime.py.
    """

    def __init__(self, model_path: Optional[str] = None, **kwargs):
        self._model_path = model_path or _resolve_model_path()
        label = (
            f"whisper.cpp/{os.path.basename(self._model_path)}"
            if _PYWHISPERCPP_AVAILABLE
            else "whisper.cpp/command-seam"
        )
        super().__init__(
            sample_rate=STT_RATE,
            settings=STTSettings(model=label, language="en"),
            **kwargs,
        )

    def can_generate_metrics(self) -> bool:
        return False

    async def run_stt(self, audio: bytes):
        tmp = os.path.join(tempfile.gettempdir(), f"wh-stt-{uuid.uuid4().hex}.wav")
        with wave.open(tmp, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate or STT_RATE)
            w.writeframes(audio)
        try:
            if _PYWHISPERCPP_AVAILABLE:
                text = await asyncio.to_thread(
                    transcribe_whisper, tmp, self._model_path
                )
            else:
                from stt import transcribe as _cmd_transcribe  # command-seam fallback
                text = await asyncio.to_thread(_cmd_transcribe, tmp)
        except Exception:
            traceback.print_exc()
            text = ""
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        if text:
            yield TranscriptionFrame(text, "", time_now_iso8601())
