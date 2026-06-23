#!/usr/bin/env python3
"""STT smoke test for the VoiceBee sidecar.

Transcribes an audio file with the configured HIVE_STT_COMMAND. Proves the STT
half of the pipeline works on the base Python with no live mic. Usage:

    .venv/bin/python smoke_stt.py <audio-file>        # aiff/wav/m4a/mp3
"""
import sys
import time

from stt import backend_label, transcribe


def main(path: str) -> int:
    start = time.time()
    result = transcribe(path)
    print(result.strip())
    print(f"[{backend_label()}] {time.time() - start:.2f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: smoke_stt.py <audio-file>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
