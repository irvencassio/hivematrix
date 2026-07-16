"""Text-to-speech for the Voice Lane sidecar.

One voice: **Kokoro-82M** via mlx-audio — a fast, natural, FIXED voice (~0.1s/reply
once warm). Set the voice with HIVE_KOKORO_VOICE (default af_heart). Callers just
call `synthesize(text)`.

macOS `say` is kept ONLY as an emergency last resort: it runs when Kokoro is
unavailable (import/model-load failure) so a turn is never left silent, and the
headless proof tests force it with `HIVE_TTS_ENGINE=say` so they load no model. It
is not a selectable voice — Kokoro is the voice.

NB: Chatterbox-Turbo was evaluated (2026-06-20) and is BROKEN in this mlx-audio
build — it ignores the input text and parrots the reference clip. Do not use it.
"""
import os
import re
import subprocess
import tempfile
import traceback
import uuid

SAMPLE_RATE = 16000

# Kokoro: the one Voice Lane voice. Voice is configurable (af_heart = warm female;
# am_michael/am_adam male; bf_emma British …) via env.
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


def _out_path(out_path: str | None) -> str:
    return out_path or os.path.join(tempfile.gettempdir(), f"tts-{uuid.uuid4().hex}.wav")


def synthesize(text: str, out_path: str | None = None, voice: str | None = None,
               rate: int = SAMPLE_RATE, lang: str = "en") -> str:
    """Synthesize `text` to a WAV and return its path, in the Kokoro voice.

    `voice` overrides HIVE_KOKORO_VOICE; `lang` is advisory (the Kokoro voice prefix
    selects language). Falls back to macOS `say` only if Kokoro is unavailable, or
    when `HIVE_TTS_ENGINE=say` forces it (headless tests)."""
    clean = (text or "").strip()
    if not clean:
        raise ValueError("synthesize: empty text")
    out = _out_path(out_path)

    if os.environ.get("HIVE_TTS_ENGINE") == "say":
        return _synthesize_say(clean, out, voice, rate)
    try:
        return _synthesize_kokoro(clean, out, voice, lang)
    except Exception:
        traceback.print_exc()
        # Kokoro is unavailable (import/model failure) — never leave a turn silent.
        return _synthesize_say(clean, out, voice, rate)


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


# In-process cache of the loaded Kokoro model. mlx-audio's generate_audio reloads
# the model from disk on EVERY call; in a long-lived process (the turn/realtime
# server) that reload dominates per-turn latency. Loading once and reusing the
# nn.Module turns each turn from "reload + synth" into just "synth". `warmup()` primes it.
_KOKORO_MODEL = None


def _kokoro_model():
    global _KOKORO_MODEL
    if _KOKORO_MODEL is None:
        from mlx_audio.tts.utils import load_model
        _KOKORO_MODEL = load_model(model_path=KOKORO_MODEL)
    return _KOKORO_MODEL


def _kokoro_run(text: str, out_path: str, voice: str | None, speed: float = 1.0) -> str | None:
    """One Kokoro pass. Returns out_path, or None if Kokoro emitted no audio.
    `speed` (1.0 = normal) nudges the output length — used to dodge mlx-audio's
    length-dependent broadcast crash without changing the voice or the words."""
    import glob
    from mlx_audio.tts.generate import generate_audio
    out_dir = os.path.dirname(out_path) or "."
    prefix = os.path.splitext(os.path.basename(out_path))[0]
    # The voice prefix (af_/am_/bf_ …) selects language+speaker; no lang_code needed.
    try:
        generate_audio(
            text=text, model=_kokoro_model(), voice=voice or KOKORO_VOICE, speed=speed,
            output_path=out_dir, file_prefix=prefix, audio_format="wav", verbose=False,
        )
    except Exception:
        pass  # mlx can raise on its length bug; treat as "no audio", caller retries
    if os.path.exists(out_path):
        return out_path
    # generate_audio chunks long text into {prefix}_000.wav, _001 … Take them in
    # order; concatenate if it split into several. Empty → None (no audio made).
    parts = sorted(glob.glob(os.path.join(out_dir, f"{prefix}_*.wav")))
    if not parts:
        return None
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


# Split a reply into ONE sentence per chunk. mlx-audio's generate_audio crashes
# (broadcast_shapes: the noise buffer is sized for one segment, the sine source
# for another) whenever a single call produces MORE THAN ONE segment — even two
# short sentences fail, dropping everything after the first. Since one sentence is
# one segment, splitting to sentence granularity and synthesizing each separately
# is the only reliable way to voice a multi-sentence/paragraph reply in full.
# Splits on sentence enders AND newlines (both create mlx segments).
_SYNTH_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+|\n+")


def _split_for_synth(text: str) -> list[str]:
    return [p.strip() for p in _SYNTH_SPLIT_RE.split((text or "").strip()) if p.strip()]


# Small tempo nudges to retry a sentence that hit mlx-audio's length-dependent
# broadcast crash. A ~3-10% speed change shifts the frame count enough to dodge
# the bug while keeping the SAME Kokoro voice and the SAME words (only that one
# sentence is imperceptibly faster). 1.0 is tried first via the normal path.
_SYNTH_RETRY_SPEEDS = (1.03, 1.06, 1.1)


def _kokoro_run_padded(text: str, out_path: str, voice: str | None) -> str | None:
    """Kokoro at normal speed, then two recovery strategies if it emits nothing:
    (1) a too-short phrase (Kokoro voices nothing for "Sure.") → retry with terminal
    punctuation; (2) mlx's length crash → retry at slightly higher speeds. Keeps one
    voice and the exact words throughout. Returns the path, or None if all fail."""
    result = _kokoro_run(text, out_path, voice)
    if result is not None:
        return result
    padded = text if text.rstrip().endswith((".", "!", "?", "…", ",")) else text.rstrip() + "."
    if padded != text:
        result = _kokoro_run(padded, out_path, voice)
        if result is not None:
            return result
    for spd in _SYNTH_RETRY_SPEEDS:
        result = _kokoro_run(text, out_path, voice, speed=spd)
        if result is not None:
            return result
    return None


def _synthesize_kokoro(text: str, out_path: str, voice: str | None, lang: str = "en") -> str:
    """Fast synthesis (Kokoro-82M). ~0.1s/reply once warm.

    Long/multi-paragraph replies are synthesized one sentence-group at a time and
    concatenated: mlx-audio's generate_audio crashes when it batches multiple
    segments internally, so we never hand it more than one segment at a time.
    Kokoro also silently emits nothing for some very short phrases (e.g. "Sure.");
    we retry each chunk once with terminal punctuation. Raises only if NOTHING was
    produced (then the caller's emergency `say` path runs)."""
    chunks = _split_for_synth(text)
    if len(chunks) <= 1:
        result = _kokoro_run_padded(text, out_path, voice)
        if result is None:
            raise RuntimeError(f"kokoro produced no audio for text={text[:80]!r}")
        return result

    out_dir = os.path.dirname(out_path) or "."
    base = os.path.splitext(os.path.basename(out_path))[0]
    parts: list[str] = []
    for i, chunk in enumerate(chunks):
        seg = os.path.join(out_dir, f"{base}__seg{i:03d}.wav")
        result = _kokoro_run_padded(chunk, seg, voice)
        if result is None:
            # mlx-audio can crash (broadcast_shapes) on specific phoneme lengths
            # for one sentence even after retries. Don't patch a different
            # engine's chunk in here — that produces one reply audibly split
            # across two voices. Raise so the caller's whole-reply `say`
            # fallback (synthesize()'s try/except) re-voices the ENTIRE text
            # in one consistent voice instead.
            for p in parts:
                try:
                    os.remove(p)
                except OSError:
                    pass
            raise RuntimeError(f"kokoro produced no audio for chunk {i}: {chunk[:80]!r}")
        parts.append(seg)
    if not parts:
        raise RuntimeError(f"kokoro produced no audio for text={text[:80]!r}")
    if len(parts) == 1:
        os.replace(parts[0], out_path)
    else:
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


def warmup(lang: str = "en") -> None:
    """Preload Kokoro + run one throwaway synthesis so the first real turn isn't
    cold. Best-effort; never raises."""
    try:
        out = os.path.join(tempfile.gettempdir(), f"tts-warmup-{uuid.uuid4().hex}.wav")
        try:
            synthesize("Ready.", out, lang=lang)
        finally:
            try:
                os.remove(out)
            except OSError:
                pass
    except Exception:
        traceback.print_exc()
