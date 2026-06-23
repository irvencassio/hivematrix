"""Speech-to-text adapter for the VoiceBee sidecar.

HiveMatrix no longer vendors a fixed STT engine here. Instead, set
HIVE_STT_COMMAND to a local command that writes the transcript to stdout. The
audio path is appended automatically unless the command contains an {audio}
placeholder. An optional {model} placeholder receives the caller-provided model
label or HIVE_STT_MODEL.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from typing import Optional


DEFAULT_MODEL = os.environ.get("HIVE_STT_MODEL", "")
DEFAULT_LABEL = os.environ.get("HIVE_STT_LABEL", "command-stt")


def backend_label(model: Optional[str] = None) -> str:
    """Human-readable label for logs and Pipecat metadata."""
    return model or DEFAULT_MODEL or DEFAULT_LABEL


def _command_for(audio_path: str, model: Optional[str] = None) -> str:
    raw = os.environ.get("HIVE_STT_COMMAND", "").strip()
    if not raw:
        raise RuntimeError(
            "STT backend is not configured. Set HIVE_STT_COMMAND to a local "
            "transcription command that prints transcript text to stdout."
        )

    quoted_audio = shlex.quote(audio_path)
    quoted_model = shlex.quote(model or DEFAULT_MODEL)
    if "{audio}" in raw or "{model}" in raw:
        return raw.format(audio=quoted_audio, model=quoted_model)
    return f"{raw} {quoted_audio}"


def transcribe(audio_path: str, model: Optional[str] = None) -> str:
    """Transcribe an audio file. Returns an empty string for silence."""
    cmd = _command_for(audio_path, model)
    result = subprocess.run(
        cmd,
        shell=True,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"STT command failed ({result.returncode}): {detail[-500:]}")
    return (result.stdout or "").strip()
