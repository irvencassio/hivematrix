"""Unit checks for the command-backed STT adapter."""
import os
import sys
import tempfile

import stt


def test_transcribe_uses_configured_command() -> None:
    old = os.environ.get("HIVE_STT_COMMAND")
    try:
        os.environ["HIVE_STT_COMMAND"] = (
            f"{sys.executable} -c \"import sys; print('heard ' + sys.argv[1].split('/')[-1])\" {{audio}}"
        )
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            assert stt.transcribe(f.name) == f"heard {os.path.basename(f.name)}"
    finally:
        if old is None:
            os.environ.pop("HIVE_STT_COMMAND", None)
        else:
            os.environ["HIVE_STT_COMMAND"] = old


def test_transcribe_requires_backend() -> None:
    old = os.environ.pop("HIVE_STT_COMMAND", None)
    try:
        try:
            stt.transcribe("/tmp/no-audio.wav")
        except RuntimeError as e:
            assert "HIVE_STT_COMMAND" in str(e)
        else:
            raise AssertionError("expected missing backend to raise")
    finally:
        if old is not None:
            os.environ["HIVE_STT_COMMAND"] = old


if __name__ == "__main__":
    test_transcribe_uses_configured_command()
    test_transcribe_requires_backend()
    print("stt tests passed")
