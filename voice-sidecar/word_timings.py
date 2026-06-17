#!/usr/bin/env python3
"""Word-level timestamps for caption sync (Phase 4 video factory).

Transcribes narration audio with mlx-whisper and emits word timings as JSON, for
the Remotion captions track:  {"text", "duration", "words": [{word,start,end}]}.

    python word_timings.py narration.wav [out.json] [--lang it]
"""
import argparse
import json
import os
import sys

import mlx_whisper

MODEL = os.environ.get("HIVE_STT_MODEL", "mlx-community/whisper-large-v3-turbo")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--lang", default=None, help="force a language (e.g. 'it'); default auto-detect")
    a = ap.parse_args()

    kwargs = {"path_or_hf_repo": MODEL, "word_timestamps": True}
    if a.lang:
        kwargs["language"] = a.lang
    r = mlx_whisper.transcribe(a.audio, **kwargs)

    words = []
    for seg in r.get("segments", []):
        for w in seg.get("words", []):
            token = (w.get("word") or "").strip()
            if token:
                words.append({"word": token,
                              "start": round(float(w["start"]), 3),
                              "end": round(float(w["end"]), 3)})
    data = {"text": (r.get("text") or "").strip(),
            "duration": words[-1]["end"] if words else 0.0,
            "words": words}
    payload = json.dumps(data)
    if a.out:
        with open(a.out, "w") as f:
            f.write(payload)
        print(a.out)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
