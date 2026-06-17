"""Text-to-speech for the VoiceBee sidecar.

Two engines behind one `synthesize()` seam:

- **say** (bootstrap): macOS `say` → 16 kHz mono PCM WAV. Zero setup; the default
  until the operator records a voice.
- **cloned** (persona): Chatterbox via mlx-audio, zero-shot cloning from a short
  reference recording. Auto-selected once a voice profile exists at
  ~/.hivematrix/voice/profile.wav (record it with `record_voice.py`). Warm ~1.2s.

Callers just call `synthesize(text)`; the engine is chosen automatically, so the
iMessage voice reply (P1), the live `talk.py` loop, and future video narration all
speak in the cloned voice once the profile exists — no caller changes.
"""
import os
import subprocess
import tempfile
import uuid

SAMPLE_RATE = 16000
CHATTERBOX_MODEL = "mlx-community/Chatterbox-TTS-fp16"


def voice_profile_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".hivematrix", "voice", "profile.wav")


def has_voice_profile() -> bool:
    return os.path.isfile(voice_profile_path())


def _out_path(out_path: str | None) -> str:
    return out_path or os.path.join(tempfile.gettempdir(), f"tts-{uuid.uuid4().hex}.wav")


def synthesize(text: str, out_path: str | None = None, voice: str | None = None,
               rate: int = SAMPLE_RATE, engine: str | None = None,
               ref_audio: str | None = None) -> str:
    """Synthesize `text` to a WAV and return its path. Engine auto-selects:
    'cloned' when a voice profile (or ref_audio) is available, else 'say'.
    Force with engine='say'|'cloned'."""
    clean = (text or "").strip()
    if not clean:
        raise ValueError("synthesize: empty text")

    if engine is None:
        engine = "cloned" if (ref_audio or has_voice_profile()) else "say"
    if engine == "cloned":
        return _synthesize_cloned(clean, _out_path(out_path), ref_audio or voice_profile_path())
    return _synthesize_say(clean, _out_path(out_path), voice, rate)


def _synthesize_say(text: str, out_path: str, voice: str | None, rate: int) -> str:
    aiff, txt = out_path + ".aiff", out_path + ".txt"
    with open(txt, "w") as f:
        f.write(text)
    try:
        cmd = ["say"]
        if voice:
            cmd += ["-v", voice]
        cmd += ["-o", aiff, "-f", txt]
        subprocess.run(cmd, check=True)
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


def _synthesize_cloned(text: str, out_path: str, ref_audio: str) -> str:
    # mlx-audio is heavy (transformers/mlx-lm) — import only when actually cloning.
    from mlx_audio.tts.generate import generate_audio
    out_dir = os.path.dirname(out_path) or "."
    prefix = os.path.splitext(os.path.basename(out_path))[0]
    generate_audio(
        text=text, model=CHATTERBOX_MODEL, ref_audio=ref_audio,
        output_path=out_dir, file_prefix=prefix, audio_format="wav", verbose=False,
    )
    produced = os.path.join(out_dir, f"{prefix}_000.wav")
    if produced != out_path and os.path.exists(produced):
        os.replace(produced, out_path)
    return out_path
