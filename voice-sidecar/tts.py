"""Text-to-speech for the VoiceBee sidecar.

Bootstrap engine = macOS `say` (zero setup), emitting a 16 kHz mono 16-bit PCM
WAV — the format the STT/transport layers expect. This mirrors the TypeScript
side (src/lib/voice/tts.ts) and is swappable for the local cloned-voice engine
(F5-TTS/Chatterbox via mlx-audio, P1.1/P1.2) behind `synthesize()`.

Text is written to a temp file and read via `say -f` so it can't be misread as
a flag.
"""
import os
import subprocess
import tempfile
import uuid

SAMPLE_RATE = 16000


def synthesize(text: str, out_path: str | None = None, voice: str | None = None,
               rate: int = SAMPLE_RATE) -> str:
    """Synthesize `text` to a mono PCM WAV and return its path. Raises on empty."""
    clean = (text or "").strip()
    if not clean:
        raise ValueError("synthesize: empty text")

    out_path = out_path or os.path.join(tempfile.gettempdir(), f"tts-{uuid.uuid4().hex}.wav")
    aiff = out_path + ".aiff"
    txt = out_path + ".txt"
    with open(txt, "w") as f:
        f.write(clean)
    try:
        say = ["say"]
        if voice:
            say += ["-v", voice]
        say += ["-o", aiff, "-f", txt]
        subprocess.run(say, check=True)
        # 16 kHz mono 16-bit PCM WAV
        subprocess.run(
            ["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", aiff, out_path],
            check=True,
        )
    finally:
        for p in (aiff, txt):
            try:
                os.remove(p)
            except OSError:
                pass
    return out_path
