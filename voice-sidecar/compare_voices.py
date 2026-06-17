#!/usr/bin/env python3
"""A/B several cloning models on YOUR reference, so you can pick the closest.

Synthesizes the same sentence with each model using ~/.hivematrix/voice/profile.wav
as the reference, writes labeled WAVs to /tmp/voice_compare, and (optionally) plays
them back-to-back. First run downloads each model (can be slow/large).

    .venv/bin/python compare_voices.py                      # default sentence, then plays each
    .venv/bin/python compare_voices.py "your own sentence"
    .venv/bin/python compare_voices.py "..." --no-play
"""
import os
import subprocess
import sys
import time

from mlx_audio.tts.generate import generate_audio

PROFILE = os.path.expanduser("~/.hivematrix/voice/profile.wav")
OUT = "/tmp/voice_compare"

MODELS = {
    "chatterbox": "mlx-community/Chatterbox-TTS-fp16",
    "qwen3tts":   "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
    "voxcpm2":    "mlx-community/VoxCPM2-bf16",
}


def main() -> int:
    if not os.path.isfile(PROFILE):
        print(f"No voice profile at {PROFILE} — run record_voice.py first.")
        return 1
    args = [a for a in sys.argv[1:] if a != "--no-play"]
    play = "--no-play" not in sys.argv
    text = args[0] if args else "Hi, this is my voice, running entirely on my own machine."

    os.makedirs(OUT, exist_ok=True)
    produced = []
    for name, repo in MODELS.items():
        try:
            t = time.time()
            generate_audio(text=text, model=repo, ref_audio=PROFILE,
                           output_path=OUT, file_prefix=name, audio_format="wav", verbose=False)
            path = os.path.join(OUT, f"{name}_000.wav")
            print(f"[ok]   {name:12s} {time.time()-t:5.1f}s  {path}")
            produced.append((name, path))
        except Exception as e:  # noqa: BLE001 — report and continue to the next model
            print(f"[skip] {name:12s} {type(e).__name__}: {str(e)[:140]}")

    if play and produced:
        print("\n▶ Playing each (listen for which sounds most like you):")
        for name, path in produced:
            print(f"  → {name}")
            subprocess.run(["afplay", path], check=False)
    print(f"\nFiles in {OUT}. Re-play any:  afplay {OUT}/<model>_000.wav")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
