#!/usr/bin/env python3
"""One voice turn for the in-app push-to-talk surface (Phase 4 app integration).

Input audio (any format ffmpeg reads) → STT → local LLM → cloned-voice TTS. Writes
the reply audio to <out> and prints {"transcript", "reply"} as JSON. Uses the
'fast' cloned tier for lower latency. The daemon's /voice/turn endpoint drives it.

    python turn_cli.py input.webm reply.m4a [--lang en]
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
    ap.add_argument("input")
    ap.add_argument("out")
    ap.add_argument("--lang", default="en")
    a = ap.parse_args()

    transcript = transcribe(a.input)
    if not transcript:
        print(json.dumps({"transcript": "", "reply": ""}))
        return 0

    reply = LocalLLM().respond_with_tools(transcript)
    # Match turn_server: speak an acknowledgment (not a refusal) when escalating.
    escalated, reply = resolve_escalation(transcript, reply)
    if reply.strip():
        wav = synthesize(reply, quality="fast", lang=a.lang)
        ext = os.path.splitext(a.out)[1].lower()
        if ext == ".wav":
            os.replace(wav, a.out)
        else:
            fmt = "caff" if ext == ".caf" else "m4af"
            subprocess.run(["afconvert", "-f", fmt, "-d", "aac", wav, a.out], check=True)
            try:
                os.remove(wav)
            except OSError:
                pass

    print(json.dumps({"transcript": transcript, "reply": reply, "escalated": escalated}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
