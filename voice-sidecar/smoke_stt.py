#!/usr/bin/env python3
"""STT smoke test for the VoiceBee sidecar.

Transcribes an audio file with mlx-whisper (local, Apple Silicon / MLX). Proves
the STT half of the pipeline works on the base Python with no live mic — the
first reliability gate for Phase 2. Usage:

    .venv/bin/python smoke_stt.py <audio-file>        # aiff/wav/m4a/mp3

Swap MODEL to "mlx-community/whisper-large-v3" for production-grade accuracy;
"whisper-tiny" keeps the smoke fast.
"""
import sys
import time

import mlx_whisper

MODEL = "mlx-community/whisper-tiny"


def main(path: str) -> int:
    start = time.time()
    result = mlx_whisper.transcribe(path, path_or_hf_repo=MODEL)
    print(result["text"].strip())
    print(f"[{MODEL}] {time.time() - start:.2f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: smoke_stt.py <audio-file>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
