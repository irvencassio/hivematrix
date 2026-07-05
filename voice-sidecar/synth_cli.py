#!/usr/bin/env python3
"""CLI bridge: synthesize text to an audio file in the cloned voice.

Called by the HiveMatrix daemon (TypeScript) so iMessage voice notes use the
operator's VoxCPM2 voice. Outputs the format implied by --out's extension
(.m4a → AAC via afconvert, else .wav). Falls back to `say` internally if no
profile exists (tts.synthesize handles that).

    python synth_cli.py --text-file note.txt --out /path/voice.m4a [--quality high|fast]
"""
import argparse
import os
import subprocess
import sys

from tts import synthesize


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text")
    ap.add_argument("--text-file", dest="text_file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--quality", default="high")
    ap.add_argument("--lang", default="en")
    a = ap.parse_args()

    text = a.text
    if a.text_file:
        with open(a.text_file, "r") as f:
            text = f.read()
    if not text or not text.strip():
        print("synth_cli: empty text", file=sys.stderr)
        return 2

    ext = os.path.splitext(a.out)[1].lower()
    if ext == ".wav":
        synthesize(text, out_path=a.out, quality=a.quality, lang=a.lang)
    else:
        wav = a.out + ".wav"
        synthesize(text, out_path=wav, quality=a.quality, lang=a.lang)
        fmt = "caff" if ext == ".caf" else "m4af"  # default to MPEG-4/AAC
        # 64 kbps (max for 24 kHz mono) — default ~32 kbps sounds thin.
        subprocess.run(["afconvert", "-f", fmt, "-d", "aac", "-b", "64000", wav, a.out], check=True)
        try:
            os.remove(wav)
        except OSError:
            pass

    print(a.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
