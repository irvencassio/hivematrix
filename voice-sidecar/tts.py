"""Text-to-speech for the Voice Lane sidecar.

Engines behind one `synthesize()` seam, selected by *intent* (the `quality` arg):

- **kokoro** (interactive / live Talk, `quality="fast"`): Kokoro-82M via mlx-audio.
  A fast, natural, FIXED voice (not cloned) — ~0.1s/reply once warm. The live path
  is "latency-first, voice identity irrelevant" (the clone is for produced audio),
  so Talk uses Kokoro. Set the voice with HIVE_KOKORO_VOICE (default af_heart).
- **cloned** (produced audio, `quality="high"`): VoxCPM2 via mlx-audio, zero-shot
  from the operator's reference (~/.hivematrix/voice/profile.wav). The persona
  voice for voice notes + the video factory. steps=32 best fidelity.
- **say** (bootstrap): macOS `say`. No profile, no Kokoro, or forced fallback.

Callers just call `synthesize(text)` (defaults to `high` → cloned); live drivers
pass `quality="fast"` (→ Kokoro). `HIVE_TTS_ENGINE=say|cloned|kokoro` force-overrides
selection (the fast headless tests force `say` so they load no model).

NB: Chatterbox-Turbo was evaluated (2026-06-20) and is BROKEN in this mlx-audio
build — it ignores the input text and parrots the reference clip. Do not use it.
"""
import os
import subprocess
import tempfile
import traceback
import uuid

SAMPLE_RATE = 16000
VOXCPM_MODEL = "mlx-community/VoxCPM2-bf16"

# Kokoro: fast non-cloning TTS for the interactive Talk loop. Voice is configurable
# (af_heart = warm female; am_michael/am_adam male; bf_emma British …) via env.
KOKORO_MODEL = "mlx-community/Kokoro-82M-bf16"
KOKORO_VOICE = os.environ.get("HIVE_KOKORO_VOICE", "af_heart")


def _ensure_espeak_env() -> None:
    """Point phonemizer at the pip-shipped espeak-ng lib (espeakng-loader) so
    Kokoro's G2P works with NO system espeak-ng install. Must run before misaki's
    espeak submodule imports (it binds the library at import). No-op if a library
    is already configured, or the loader isn't installed (then Kokoro falls back)."""
    if os.environ.get("PHONEMIZER_ESPEAK_LIBRARY"):
        return
    try:
        import espeakng_loader
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = espeakng_loader.get_library_path()
        os.environ.setdefault("ESPEAK_DATA_PATH", espeakng_loader.get_data_path())
    except Exception:
        pass


_ensure_espeak_env()

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
        forced = os.environ.get("HIVE_TTS_ENGINE")
        if forced:
            engine = forced
        elif quality == "fast":
            engine = "kokoro"  # interactive Talk: fast generic voice
        elif ref_audio or has_voice_profile():
            engine = "cloned"  # produced audio: the persona clone
        else:
            engine = "say"
    if engine == "kokoro":
        try:
            return _synthesize_kokoro(clean, _out_path(out_path), voice, lang)
        except Exception:
            traceback.print_exc()
            # Kokoro made no audio (short-phrase quirk) or is unavailable — fall back
            # to macOS `say`. It's instant, so the fast path stays fast (the clone
            # would add ~2.5s for what is usually a tiny phrase).
            engine = "say"
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


def _kokoro_model():
    m = _CLONE_MODELS.get("__kokoro__")
    if m is None:
        from mlx_audio.tts.utils import load_model
        m = load_model(model_path=KOKORO_MODEL)
        _CLONE_MODELS["__kokoro__"] = m
    return m


def _synthesize_kokoro(text: str, out_path: str, voice: str | None, lang: str = "en") -> str:
    """Fast non-cloning synthesis (Kokoro-82M). ~0.1s/reply once warm.

    Raises if Kokoro produces no audio (it silently emits nothing for some short
    phrases, e.g. "Sure thing.") so the caller can fall back to a working engine.
    """
    import glob
    from mlx_audio.tts.generate import generate_audio
    out_dir = os.path.dirname(out_path) or "."
    prefix = os.path.splitext(os.path.basename(out_path))[0]
    # The voice prefix (af_/am_/bf_ …) selects language+speaker; no lang_code needed.
    generate_audio(
        text=text, model=_kokoro_model(), voice=voice or KOKORO_VOICE,
        output_path=out_dir, file_prefix=prefix, audio_format="wav", verbose=False,
    )
    if os.path.exists(out_path):
        return out_path
    # generate_audio chunks long text into {prefix}_000.wav, _001 … Take them in
    # order; concatenate if it split into several. Empty → raise (no audio made).
    parts = sorted(glob.glob(os.path.join(out_dir, f"{prefix}_*.wav")))
    if not parts:
        raise RuntimeError(f"kokoro produced no audio for text={text[:80]!r}")
    if len(parts) == 1:
        os.replace(parts[0], out_path)
        return out_path
    _concat_wavs(parts, out_path)
    for p in parts:
        try:
            os.remove(p)
        except OSError:
            pass
    return out_path


def _concat_wavs(parts: list[str], out_path: str) -> None:
    """Concatenate same-format WAV chunks into out_path (stdlib wave)."""
    import wave
    with wave.open(parts[0]) as w0:
        params = w0.getparams()
        frames = [w0.readframes(w0.getnframes())]
    for p in parts[1:]:
        with wave.open(p) as w:
            frames.append(w.readframes(w.getnframes()))
    with wave.open(out_path, "w") as out:
        out.setparams(params)
        for fr in frames:
            out.writeframes(fr)


def warmup(quality: str = "fast", lang: str = "en") -> None:
    """Preload the engine that `quality` selects + run one throwaway synthesis so
    the first real turn isn't cold. `fast` warms Kokoro (the live path); `high`
    warms the clone. Best-effort; never raises."""
    try:
        # 'fast' warms Kokoro even with no profile; 'high'/cloned needs a profile.
        if quality != "fast" and not has_voice_profile():
            return
        out = os.path.join(tempfile.gettempdir(), f"tts-warmup-{uuid.uuid4().hex}.wav")
        try:
            synthesize("Ready.", out, quality=quality, lang=lang)
        finally:
            try:
                os.remove(out)
            except OSError:
                pass
    except Exception:
        traceback.print_exc()


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
