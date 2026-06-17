#!/usr/bin/env python3
"""Hands-free live voice mode (P3 realtime): VAD turn-taking + barge-in.

Unlike talk.py (press Enter to start/stop), this listens continuously. A VAD
(vad.py) decides when you start and stop talking; on stop it runs the streaming
turn (STT → Qwen → cloned-voice TTS) and speaks the reply. If you start talking
while the assistant is still speaking, playback stops immediately — barge-in.

Local mic only (no WebRTC; that's the iOS/remote transport, P2.5). Needs mic
access and LM Studio serving the local model (or HIVE_LLM_* set).

    .venv/bin/python live.py
    .venv/bin/python live.py --seconds 20   # auto-exit after N seconds (for a timed test)

Echo caveat: without acoustic echo cancellation the mic hears the assistant's
own voice through the speakers, which can false-trigger barge-in. Use headphones,
or raise --barge-rms. (AEC belongs in the Pipecat/WebRTC client, P2.5.)
"""
import argparse
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

from vad import VadSegmenter, frame_rms
from stream_turn import stream_turn

SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME = SAMPLE_RATE * FRAME_MS // 1000  # 320 samples / frame
PREROLL_FRAMES = 8                      # ~160 ms kept before "start" so onsets aren't clipped


class Player:
    """Plays WAVs in order on a background thread; stop() interrupts immediately."""

    def __init__(self):
        self._q: "queue.Queue" = queue.Queue()
        self._cur: "subprocess.Popen | None" = None
        self._lock = threading.Lock()
        self._stopped = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while True:
            path = self._q.get()
            try:
                if path and not self._stopped.is_set():
                    with self._lock:
                        self._cur = subprocess.Popen(["afplay", path])
                    self._cur.wait()
            except Exception:
                pass
            finally:
                with self._lock:
                    self._cur = None
                self._q.task_done()

    def play(self, path: str):
        self._stopped.clear()
        self._q.put(path)

    def busy(self) -> bool:
        with self._lock:
            return self._cur is not None or not self._q.empty()

    def stop(self):
        """Kill current playback and drop anything queued (barge-in)."""
        self._stopped.set()
        with self._lock:
            if self._cur and self._cur.poll() is None:
                self._cur.terminate()
        try:
            while True:
                self._q.get_nowait()
                self._q.task_done()
        except queue.Empty:
            pass


def write_wav(path, frames):
    audio = np.concatenate(frames, axis=0) if frames else np.zeros((0, 1), dtype="int16")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(audio.tobytes())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=0, help="auto-exit after N seconds (0 = run until Ctrl-C)")
    ap.add_argument("--barge-in", action="store_true",
                    help="allow interrupting the assistant by talking over it (headphones only — "
                         "without echo cancellation the mic hears the assistant and self-interrupts)")
    ap.add_argument("--barge-rms", type=float, default=1500, help="RMS to trigger barge-in while speaking")
    ap.add_argument("--quality", default="fast", help="TTS quality: fast | high")
    args = ap.parse_args()

    from llm import LocalLLM
    llm = LocalLLM()
    player = Player()

    listen_vad = VadSegmenter()                              # detect the user's turn
    barge_vad = VadSegmenter(start_rms=args.barge_rms, start_frames=4)  # stricter while we speak

    audio_q: "queue.Queue" = queue.Queue()

    def cb(indata, _frames, _t, _status):
        audio_q.put(indata.copy())

    preroll: list = []
    utter: list = []
    capturing = False
    was_busy = False
    cooldown = 0  # frames to ignore after playback ends (let echo/reverb tail decay)
    started_at = time.time()

    mode = "barge-in" if args.barge_in else "half-duplex"
    print(f"VoiceBee live ({mode}) — just start talking. Ctrl-C to exit.", flush=True)
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME, callback=cb):
        while True:
            if args.seconds and time.time() - started_at > args.seconds:
                break
            try:
                frame = audio_q.get(timeout=0.5)
            except queue.Empty:
                continue
            rms = frame_rms(frame)

            # While the assistant is speaking: half-duplex ignores the mic (the
            # default — without AEC the mic hears the assistant and would
            # self-interrupt). --barge-in lets a real interruption cut it off.
            if player.busy():
                if args.barge_in and barge_vad.push_rms(rms) == "start":
                    print("  …barge-in", flush=True)
                    player.stop()
                    listen_vad.reset()
                    capturing = True
                    utter = list(preroll) + [frame]
                preroll.append(frame)
                if len(preroll) > PREROLL_FRAMES:
                    preroll.pop(0)
                was_busy = True
                continue

            # Just finished speaking: clear echo-driven VAD state and skip a few
            # frames so the speaker's reverb tail doesn't read as a new "start".
            if was_busy:
                listen_vad.reset()
                barge_vad.reset()
                preroll.clear()
                cooldown = 8
                was_busy = False
            if cooldown > 0:
                cooldown -= 1
                continue

            if capturing:
                utter.append(frame)
                if listen_vad.push_rms(rms) == "end":
                    capturing = False
                    wav = os.path.join(tempfile.gettempdir(), f"live-{uuid.uuid4().hex}.wav")
                    write_wav(wav, utter)
                    utter = []
                    res = stream_turn(wav, llm.respond_stream, on_audio=player.play, tts_quality=args.quality)
                    try:
                        os.remove(wav)
                    except OSError:
                        pass
                    if res.transcript:
                        print(f"you: {res.transcript}")
                        print(f"bee: {' '.join(res.sentences)}")
                        if res.ttfa_s is not None:
                            print(f"     (first audio {res.ttfa_s:.1f}s)", flush=True)
                    else:
                        print("…didn't catch that.", flush=True)
            else:
                preroll.append(frame)
                if len(preroll) > PREROLL_FRAMES:
                    preroll.pop(0)
                if listen_vad.push_rms(rms) == "start":
                    capturing = True
                    utter = list(preroll)

    print("bye 👋")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
