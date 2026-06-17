#!/usr/bin/env python3
"""Talk to your local VoiceBee from the Mac mic (P2.6 demo).

Push-to-talk: Enter to start, speak, Enter to stop. Records from the default mic,
runs the streaming turn (STT → Qwen → TTS), and plays the reply aloud — looping
for a real back-and-forth. No iOS, no WebRTC; just the Mac's own mic.

    .venv/bin/python talk.py

First run, macOS prompts the terminal for Microphone access — grant it. Make sure
LM Studio is serving qwen/qwen3.6-27b on :1234 with reasoning OFF.
"""
import os
import queue
import subprocess
import tempfile
import threading
import time
import uuid
import wave

import numpy as np
import sounddevice as sd

from stream_turn import stream_turn

SAMPLE_RATE = 16000


class Player:
    """Plays WAVs in order on a background thread, so reply audio starts while the
    next sentence is still being generated."""

    def __init__(self):
        self._q: queue.Queue = queue.Queue()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while True:
            path = self._q.get()
            try:
                if path:
                    subprocess.run(["afplay", path], check=False)
            finally:
                self._q.task_done()

    def play(self, path: str):
        self._q.put(path)

    def wait(self):
        self._q.join()


def record_until_enter(samplerate: int = SAMPLE_RATE):
    frames = []

    def callback(indata, _frames, _time, _status):
        frames.append(indata.copy())

    with sd.InputStream(samplerate=samplerate, channels=1, dtype="int16", callback=callback):
        print("🎙  recording… press Enter to stop", flush=True)
        input()
    if not frames:
        return None
    return np.concatenate(frames, axis=0), samplerate


def write_wav(path: str, audio: np.ndarray, samplerate: int):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # int16
        w.setframerate(samplerate)
        w.writeframes(audio.tobytes())


def run_demo(question: str) -> int:
    """No-mic smoke: speak a built-in question, ask Qwen, play the reply aloud.
    Validates the Qwen→TTS→playback chain without microphone permissions."""
    from llm import LocalLLM

    aiff = os.path.join(tempfile.gettempdir(), f"demo-q-{uuid.uuid4().hex}.aiff")
    subprocess.run(["say", "-o", aiff, question], check=True)
    player = Player()
    print(f"you (demo): {question}")
    res = stream_turn(aiff, LocalLLM().respond_stream, on_audio=player.play, tts_quality="high")
    try:
        os.remove(aiff)
    except OSError:
        pass
    print(f"bee: {' '.join(res.sentences) if res.sentences else '(empty — is reasoning OFF in LM Studio?)'}")
    if res.ttfa_s is not None:
        print(f"     (first audio {res.ttfa_s:.1f}s · total {res.total_s:.1f}s)")
    player.wait()
    return 0


def main() -> int:
    from llm import LocalLLM  # imported here so --help etc. don't need the server

    llm = LocalLLM()
    player = Player()
    print("VoiceBee — talk to your local assistant (Qwen 3.6 27B). Ctrl-C to exit.")

    while True:
        try:
            cmd = input("\n⏎ Enter to talk  ·  q + Enter to quit: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            break
        if cmd == "q":
            break

        rec = record_until_enter()
        if rec is None:
            print("(nothing recorded)")
            continue
        audio, samplerate = rec
        if len(audio) < samplerate // 4:  # < 0.25s
            print("(too short)")
            continue

        wav = os.path.join(tempfile.gettempdir(), f"talk-{uuid.uuid4().hex}.wav")
        write_wav(wav, audio, samplerate)

        start = time.time()
        first_audio = {"t": None}

        def on_audio(path):
            if first_audio["t"] is None:
                first_audio["t"] = time.time() - start
            player.play(path)

        res = stream_turn(wav, llm.respond_stream, on_audio=on_audio)
        try:
            os.remove(wav)
        except OSError:
            pass

        if not res.transcript:
            print("…didn't catch that.")
            continue
        print(f"you: {res.transcript}")
        print(f"bee: {' '.join(res.sentences)}")
        ttfa = first_audio["t"]
        if ttfa is not None:
            print(f"     (first audio {ttfa:.1f}s · total {res.total_s:.1f}s)")
        player.wait()

    print("bye 👋")
    return 0


if __name__ == "__main__":
    import sys
    if "--demo" in sys.argv:
        i = sys.argv.index("--demo")
        q = sys.argv[i + 1] if len(sys.argv) > i + 1 else "What is the capital of France?"
        raise SystemExit(run_demo(q))
    raise SystemExit(main())
