"""Headless proof of the VoiceBee turn loop (P2.2).

Drives audio in → real STT (mlx-whisper) → STUBBED LLM → real TTS (say), with no
mic and no live model. Proves the loop wiring end-to-end. Run:

    .venv/bin/python test_turn.py
"""
import os
os.environ.setdefault("HIVE_TTS_ENGINE", "say")  # keep tests fast + deterministic

import subprocess
import sys
import tempfile
import uuid

from turn import run_turn


def _say_to_file(text: str) -> str:
    path = os.path.join(tempfile.gettempdir(), f"in-{uuid.uuid4().hex}.aiff")
    subprocess.run(["say", "-o", path, text], check=True)
    return path


def main() -> int:
    audio_in = _say_to_file("what is two plus two")

    captured = {}

    def stub_respond(text: str) -> str:
        captured["transcript"] = text
        return "Two plus two is four."

    result = run_turn(audio_in, stub_respond)

    assert result.transcript, "STT produced no transcript"
    # whisper may normalize "two" -> "2"; assert on the stable token.
    assert "plus" in captured.get("transcript", "").lower(), \
        f"transcript did not reach the LLM: {captured.get('transcript')!r}"
    assert result.reply == "Two plus two is four.", f"unexpected reply: {result.reply!r}"
    assert result.audio_out and os.path.getsize(result.audio_out) > 0, "no TTS audio produced"

    print(f"OK  transcript={result.transcript!r}  reply={result.reply!r}  "
          f"audio={os.path.getsize(result.audio_out)}B")
    os.remove(audio_in)
    os.remove(result.audio_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
