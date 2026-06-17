"""Text-to-speech for the VoiceBee sidecar.

Engines behind one `synthesize()` seam, auto-selected once a voice profile exists
(~/.hivematrix/voice/profile.wav, recorded via record_voice.py):

- **say** (bootstrap): macOS `say`. No profile / forced fallback.
- **cloned**: VoxCPM2 via mlx-audio, zero-shot from the reference (auto-transcribed
  by whisper). Two quality tiers — the operator chose VoxCPM2 with steps=32 as the
  closest clone:
    high  → steps=32  (~4.6s)  best fidelity; for produced audio (voice notes, video)
    fast  → steps=8   (~2.5s)  same timbre, lower latency; for the live talk loop

Callers just call `synthesize(text)` (defaults to `high`); live drivers pass
`quality="fast"`. `HIVE_TTS_ENGINE=say|cloned` env var force-overrides selection
(used by the fast headless tests so they don't load the clone model).
"""
import os
import subprocess
import tempfile
import uuid

SAMPLE_RATE = 16000
VOXCPM_MODEL = "mlx-community/VoxCPM2-bf16"

# Cloned-voice quality tiers (operator-tuned: VoxCPM2, cfg=3.0, temp=0.5).
CLONE_TIERS = {
    "high": {"model": VOXCPM_MODEL, "params": {"ddpm_steps": 32, "cfg_scale": 3.0, "temperature": 0.5}},
    "fast": {"model": VOXCPM_MODEL, "params": {"ddpm_steps": 8,  "cfg_scale": 3.0, "temperature": 0.5}},
}
DEFAULT_QUALITY = "high"


def voice_profile_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".hivematrix", "voice", "profile.wav")


def has_voice_profile() -> bool:
    return os.path.isfile(voice_profile_path())


def _out_path(out_path: str | None) -> str:
    return out_path or os.path.join(tempfile.gettempdir(), f"tts-{uuid.uuid4().hex}.wav")


def synthesize(text: str, out_path: str | None = None, voice: str | None = None,
               rate: int = SAMPLE_RATE, engine: str | None = None,
               ref_audio: str | None = None, quality: str = DEFAULT_QUALITY,
               lang: str = "en") -> str:
    """Synthesize `text` to a WAV; return its path. Engine auto-selects 'cloned'
    when a profile (or ref_audio) exists, else 'say'. `HIVE_TTS_ENGINE` overrides.
    `quality` ('high'|'fast') picks the cloned tier. `lang` (e.g. 'en', 'it') is a
    hint for the cloned engine; the cloned voice is multilingual (text-driven)."""
    clean = (text or "").strip()
    if not clean:
        raise ValueError("synthesize: empty text")

    if engine is None:
        engine = os.environ.get("HIVE_TTS_ENGINE") or (
            "cloned" if (ref_audio or has_voice_profile()) else "say")
    if engine == "cloned":
        return _synthesize_cloned(clean, _out_path(out_path), ref_audio or voice_profile_path(), quality, lang)
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


def _synthesize_cloned(text: str, out_path: str, ref_audio: str,
                       quality: str = DEFAULT_QUALITY, lang: str = "en") -> str:
    # mlx-audio is heavy (transformers/mlx-lm) — import only when actually cloning.
    from mlx_audio.tts.generate import generate_audio
    tier = CLONE_TIERS.get(quality, CLONE_TIERS["high"])
    out_dir = os.path.dirname(out_path) or "."
    prefix = os.path.splitext(os.path.basename(out_path))[0]
    generate_audio(
        text=text, model=tier["model"], ref_audio=ref_audio,
        output_path=out_dir, file_prefix=prefix, audio_format="wav", verbose=False,
        lang_code=lang, **tier["params"],
    )
    produced = os.path.join(out_dir, f"{prefix}_000.wav")
    if produced != out_path and os.path.exists(produced):
        os.replace(produced, out_path)
    return out_path
