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

# Cloned-voice pace. VoxCPM2 renders a touch slow/deliberate for conversation, so
# we nudge the tempo up (pitch preserved, via ffmpeg atempo). 1.0 = model native;
# 1.15 = 15% faster. Override with HIVE_TTS_SPEED.
CLONE_SPEED = float(os.environ.get("HIVE_TTS_SPEED", "1.15"))


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


# In-process cache of the loaded cloned-voice model. mlx-audio's generate_audio
# reloads the model from disk on EVERY call; in a long-lived process (the realtime
# server) that reload dominates per-turn latency. Loading once and reusing the
# nn.Module — generate_audio accepts a pre-loaded model and skips the reload —
# turns each turn from "reload + synth" into just "synth". `warmup()` primes it.
_CLONE_MODELS: dict = {}


def _clone_model(model_id: str):
    m = _CLONE_MODELS.get(model_id)
    if m is None:
        from mlx_audio.tts.utils import load_model
        m = load_model(model_path=model_id)
        _CLONE_MODELS[model_id] = m
    return m


def warmup(quality: str = "fast", lang: str = "en") -> None:
    """Preload the cloned-voice model + run one throwaway synthesis so the first
    real turn isn't cold. Best-effort; never raises."""
    try:
        if not has_voice_profile():
            return  # 'say' engine has no model to warm
        out = os.path.join(tempfile.gettempdir(), f"tts-warmup-{uuid.uuid4().hex}.wav")
        try:
            synthesize("Ready.", out, quality=quality, lang=lang)
        finally:
            try:
                os.remove(out)
            except OSError:
                pass
    except Exception:
        pass


def _synthesize_cloned(text: str, out_path: str, ref_audio: str,
                       quality: str = DEFAULT_QUALITY, lang: str = "en") -> str:
    # mlx-audio is heavy (transformers/mlx-lm) — import only when actually cloning.
    from mlx_audio.tts.generate import generate_audio
    tier = CLONE_TIERS.get(quality, CLONE_TIERS["high"])
    out_dir = os.path.dirname(out_path) or "."
    prefix = os.path.splitext(os.path.basename(out_path))[0]
    generate_audio(
        text=text, model=_clone_model(tier["model"]), ref_audio=ref_audio,
        output_path=out_dir, file_prefix=prefix, audio_format="wav", verbose=False,
        lang_code=lang, **tier["params"],
    )
    produced = os.path.join(out_dir, f"{prefix}_000.wav")
    if produced != out_path and os.path.exists(produced):
        os.replace(produced, out_path)
    _speed_up(out_path, CLONE_SPEED)
    return out_path


def _speed_up(wav_path: str, factor: float) -> None:
    """Speed up a WAV by `factor` in place, pitch-preserved (ffmpeg atempo).

    Best-effort: if ffmpeg is missing or fails we keep the native-speed audio
    rather than break synthesis. atempo handles 0.5–2.0 in one stage.
    """
    if abs(factor - 1.0) < 1e-3:
        return
    tmp = wav_path + ".sp.wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
             "-filter:a", f"atempo={factor:.3f}", tmp],
            check=True,
        )
        os.replace(tmp, wav_path)
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            os.remove(tmp)
        except OSError:
            pass
