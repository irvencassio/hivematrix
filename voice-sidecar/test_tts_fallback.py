"""Unit tests for tts._synthesize_kokoro's multi-chunk fallback behavior —
a mid-reply Kokoro failure must re-voice the WHOLE reply in one consistent
engine, never patch a different-engine chunk into an otherwise-Kokoro reply.
Mocks _kokoro_run_padded/_synthesize_say; does not load Kokoro or shell to
`say`. Run: python3 test_tts_fallback.py
"""
import os
import sys
import tempfile

import tts


def check(name, cond, detail=""):
    assert cond, f"{name}: {detail}"
    print(f"ok: {name}")


def test_all_chunks_succeed_no_say_call(tmp_out):
    calls = []
    def fake_kokoro(text, out_path, voice, speed=1.0):
        calls.append(text)
        with open(out_path, "wb") as f:
            f.write(b"RIFF....WAVEfmt ")  # placeholder, never read as real audio
        return out_path
    def fake_say(*a, **kw):
        raise AssertionError("say must not be called when all chunks succeed")
    orig_kr, orig_say = tts._kokoro_run_padded, tts._synthesize_say
    orig_concat = tts._concat_wavs
    tts._kokoro_run_padded, tts._synthesize_say = fake_kokoro, fake_say
    try:
        # _concat_wavs needs real WAV frames for >1 part; use a single-sentence
        # text here so this test only exercises the "no failure" path via the
        # multi-chunk loop's success branch (len(chunks) > 1 still hits the
        # per-chunk loop even if each succeeds) — use a 2-sentence text and
        # monkeypatch _concat_wavs too, since we only care THIS test never
        # calls the say path, not the audio bytes.
        tts._concat_wavs = lambda parts, out: open(out, "wb").write(b"ok")
        result = tts._synthesize_kokoro("First one. Second one.", tmp_out, None)
        check("returns out_path", result == tmp_out)
        check("both chunks hit kokoro", calls == ["First one.", "Second one."])
    finally:
        tts._kokoro_run_padded, tts._synthesize_say = orig_kr, orig_say
        tts._concat_wavs = orig_concat
        # This test is the only one that writes a real file to the shared
        # tmp_out path (via the _concat_wavs stub above) — remove it so later
        # tests in this module's shared-tmp_out sequence see a clean slate,
        # not a leftover file from this test's own success path.
        try:
            os.remove(tmp_out)
        except OSError:
            pass


def test_one_chunk_fails_raises_not_mixes(tmp_out):
    """The bug this fixes: chunk 2 of 3 exhausts all Kokoro attempts. Old
    behavior silently patched a `say` chunk into the concatenated output.
    New behavior must raise so the caller's whole-text `say` fallback
    (tts.synthesize's try/except) re-voices the ENTIRE reply consistently."""
    say_calls = []
    def fake_kokoro(text, out_path, voice, speed=1.0):
        if text == "Second fails.":
            return None  # simulates exhausting all 4 attempts
        with open(out_path, "wb") as f:
            f.write(b"placeholder")
        return out_path
    def fake_say(*a, **kw):
        say_calls.append(a)
        raise AssertionError("per-chunk say substitution must not happen")
    orig_kr, orig_say = tts._kokoro_run_padded, tts._synthesize_say
    tts._kokoro_run_padded, tts._synthesize_say = fake_kokoro, fake_say
    try:
        raised = False
        try:
            tts._synthesize_kokoro("First ok. Second fails. Third ok.", tmp_out, None)
        except RuntimeError:
            raised = True
        check("raises instead of substituting", raised)
        check("never called per-chunk say", say_calls == [])
        check("no output file left behind", not os.path.exists(tmp_out))
    finally:
        tts._kokoro_run_padded, tts._synthesize_say = orig_kr, orig_say


def test_no_orphaned_temp_segments(tmp_out):
    """When chunk 2 fails after chunk 1 already succeeded, chunk 1's temp
    segment WAV must be cleaned up, not leaked."""
    def fake_kokoro(text, out_path, voice, speed=1.0):
        if text == "Second fails.":
            return None
        with open(out_path, "wb") as f:
            f.write(b"placeholder")
        return out_path
    orig_kr = tts._kokoro_run_padded
    tts._kokoro_run_padded = fake_kokoro
    try:
        try:
            tts._synthesize_kokoro("First ok. Second fails.", tmp_out, None)
        except RuntimeError:
            pass
        out_dir = os.path.dirname(tmp_out) or "."
        base = os.path.splitext(os.path.basename(tmp_out))[0]
        leftover = [f for f in os.listdir(out_dir) if f.startswith(f"{base}__seg")]
        check("no leftover segment files", leftover == [], detail=str(leftover))
    finally:
        tts._kokoro_run_padded = orig_kr


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "reply.wav")
        test_all_chunks_succeed_no_say_call(out)
        test_one_chunk_fails_raises_not_mixes(out)
        test_no_orphaned_temp_segments(out)
    print("\nALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
