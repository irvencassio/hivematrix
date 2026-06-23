#!/usr/bin/env python3
"""Word-level timestamps for caption sync (Phase 4 video factory).

Uses HIVE_WORD_TIMINGS_COMMAND when configured. The command should print JSON for
the Remotion captions track:  {"text", "duration", "words": [{word,start,end}]}.
Without that command, falls back to transcript-only output from HIVE_STT_COMMAND.

    python word_timings.py narration.wav [out.json] [--lang it]
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

from stt import transcribe


def _run_word_timing_command(audio_path: str, lang: str | None) -> dict | None:
    raw = os.environ.get("HIVE_WORD_TIMINGS_COMMAND", "").strip()
    if not raw:
        return None
    cmd = raw.format(audio=shlex.quote(audio_path), lang=shlex.quote(lang or ""))
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
        raise RuntimeError(f"word timing command failed ({result.returncode}): {detail[-500:]}")
    parsed = json.loads(result.stdout or "{}")
    return {
        "text": str(parsed.get("text") or "").strip(),
        "duration": float(parsed.get("duration") or 0.0),
        "words": parsed.get("words") if isinstance(parsed.get("words"), list) else [],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--lang", default=None, help="force a language (e.g. 'it'); default auto-detect")
    a = ap.parse_args()

    data = _run_word_timing_command(a.audio, a.lang)
    if data is None:
        data = {"text": transcribe(a.audio), "duration": 0.0, "words": []}
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
