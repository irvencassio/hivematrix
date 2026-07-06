#!/usr/bin/env python3
"""One voice turn for the in-app push-to-talk surface (Phase 4 app integration).

Input audio (any format ffmpeg reads) → STT → local LLM → Kokoro TTS. Or pass a
ready transcript with --text (on-device STT) to skip server STT. Writes the reply
audio to <out> and prints {"transcript", "reply"} as JSON. The daemon's /voice/turn
endpoint drives it.

    python turn_cli.py input.webm reply.m4a [--lang en]   # audio → server STT
    python turn_cli.py reply.m4a --text "hello" [--lang en]  # on-device transcript
"""
import argparse
import json
import os
import subprocess
import sys

from llm import LocalLLM, resolve_escalation
from stt import transcribe
from tts import synthesize


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?", default=None)
    ap.add_argument("out")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--text", default=None, help="ready transcript (skips server STT)")
    a = ap.parse_args()

    if a.text is not None:
        transcript = a.text.strip()
    elif a.input:
        transcript = transcribe(a.input)
    else:
        print(json.dumps({"error": "input audio or --text is required"}))
        return 1
    if not transcript:
        print(json.dumps({"transcript": "", "reply": ""}))
        return 0

    reply = LocalLLM().respond_with_tools(transcript)
    # Match turn_server: speak an acknowledgment (not a refusal) when escalating.
    escalated, reply = resolve_escalation(transcript, reply)
    if reply.strip():
        wav = synthesize(reply, lang=a.lang)
        ext = os.path.splitext(a.out)[1].lower()
        if ext == ".wav":
            os.replace(wav, a.out)
        else:
            fmt = "caff" if ext == ".caf" else "m4af"
            # 64 kbps (max for 24 kHz mono) — default ~32 kbps sounds thin.
            subprocess.run(["afconvert", "-f", fmt, "-d", "aac", "-b", "64000", wav, a.out], check=True)
            try:
                os.remove(wav)
            except OSError:
                pass

    print(json.dumps({"transcript": transcript, "reply": reply, "escalated": escalated}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
