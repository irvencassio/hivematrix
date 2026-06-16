"""Speech-to-text for the VoiceBee sidecar — local mlx-whisper (Apple Silicon).

`HIVE_STT_MODEL` selects the model; default is whisper-tiny (fast). For
production accuracy use `mlx-community/whisper-large-v3`.
"""
import os

import mlx_whisper

# 128 GB headroom → default to large-v3-turbo (near-large accuracy, fast on MLX),
# not tiny. Override with HIVE_STT_MODEL (e.g. whisper-tiny for the fast smoke).
DEFAULT_MODEL = os.environ.get("HIVE_STT_MODEL", "mlx-community/whisper-large-v3-turbo")


def transcribe(audio_path: str, model: str | None = None) -> str:
    """Transcribe an audio file to text. Returns "" for silence."""
    result = mlx_whisper.transcribe(audio_path, path_or_hf_repo=model or DEFAULT_MODEL)
    return (result.get("text") or "").strip()
