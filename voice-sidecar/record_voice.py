#!/usr/bin/env python3
"""Record your voice once → the cloned-voice profile (P1.2).

Push-to-talk: Enter to start, read the script aloud (~30–40s, quiet room), Enter
to stop. Saves to ~/.hivematrix/voice/profile.wav. After this, tts.synthesize()
auto-uses the cloned voice everywhere (talk.py, iMessage voice notes, video).

    .venv/bin/python record_voice.py

macOS prompts the terminal for Microphone access on first run.
"""
import os
import sys
import wave

import numpy as np
import sounddevice as sd

from tts import voice_profile_path

SAMPLE_RATE = 24000  # Chatterbox reference — a bit higher than the 16k STT rate

SCRIPT = """\
Read this aloud, naturally, in a quiet room:

  "Hi, this is my voice. I'm recording a short sample so my assistant can speak
   the way I do. The weather today is clear and bright, and I have a few things
   to get done. I'll check my calendar, reply to a couple of messages, and then
   take a short break. Numbers like one, two, three, and dates like June sixteenth
   help capture how I say things. Thanks — that should be plenty."
"""


def record_until_enter(samplerate: int = SAMPLE_RATE):
    frames = []

    def cb(indata, _n, _t, _s):
        frames.append(indata.copy())

    with sd.InputStream(samplerate=samplerate, channels=1, dtype="int16", callback=cb):
        print("🎙  recording… press Enter to stop", flush=True)
        input()
    if not frames:
        return None
    return np.concatenate(frames, axis=0)


def main() -> int:
    print(SCRIPT)
    try:
        input("⏎ Press Enter to START recording (Ctrl-C to cancel): ")
    except (EOFError, KeyboardInterrupt):
        print("\ncancelled")
        return 1

    audio = record_until_enter()
    if audio is None or len(audio) < SAMPLE_RATE * 5:
        print("Recording too short (aim for ~30s). Nothing saved.")
        return 1

    path = voice_profile_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(audio.tobytes())

    secs = len(audio) / SAMPLE_RATE
    print(f"\n✅ Saved {secs:.0f}s voice profile → {path}")
    print("Test it:  .venv/bin/python talk.py --demo \"say hello in my voice\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
