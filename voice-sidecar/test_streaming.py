"""Headless proof of streaming TTS (P2.3).

1. iter_sentences chunks correctly (pure).
2. stream_turn produces first audio BEFORE the reply finishes — i.e. TTFA < total
   — using real STT + real TTS but a STUBBED, deliberately-slow token stream (no
   live model). Run: .venv/bin/python test_streaming.py
"""
import os
import subprocess
import sys
import tempfile
import time
import uuid

from streaming import iter_sentences
from stream_turn import stream_turn


def test_chunker():
    assert list(iter_sentences(["Hello world. ", "How are you?"])) == ["Hello world.", "How are you?"]
    # token-by-token streaming yields the same sentences
    toks = list("Paris is the capital. It is lovely!")
    assert list(iter_sentences(toks)) == ["Paris is the capital.", "It is lovely!"]
    # decimals/versions don't split
    assert list(iter_sentences(["Pi is 3.14 today."])) == ["Pi is 3.14 today."]
    # tail without terminal punctuation still flushes
    assert list(iter_sentences(["no period here"])) == ["no period here"]


def _say(text):
    p = os.path.join(tempfile.gettempdir(), f"in-{uuid.uuid4().hex}.aiff")
    subprocess.run(["say", "-o", p, text], check=True)
    return p


def test_stream_turn_ttfa():
    audio_in = _say("tell me about paris")

    # Stubbed LLM stream: two sentences, emitted slowly so the second clearly
    # arrives after the first sentence has already been spoken.
    def slow_stream(_transcript):
        for tok in ["Paris ", "is ", "the ", "capital ", "of ", "France. "]:
            yield tok
        time.sleep(0.4)
        for tok in ["It ", "is ", "a ", "lovely ", "city."]:
            yield tok

    r = stream_turn(audio_in, slow_stream)
    assert r.transcript, "no transcript"
    assert r.sentences == ["Paris is the capital of France.", "It is a lovely city."], r.sentences
    assert len(r.audio_paths) == 2 and all(os.path.getsize(p) > 0 for p in r.audio_paths)
    assert r.ttfa_s is not None and r.ttfa_s < r.total_s, \
        f"TTFA {r.ttfa_s} should be < total {r.total_s} (streaming benefit)"

    print(f"OK  sentences={len(r.sentences)}  ttfa={r.ttfa_s:.2f}s  total={r.total_s:.2f}s")
    os.remove(audio_in)
    for p in r.audio_paths:
        os.remove(p)


if __name__ == "__main__":
    test_chunker()
    test_stream_turn_ttfa()
    print("streaming tests passed")
    sys.exit(0)
