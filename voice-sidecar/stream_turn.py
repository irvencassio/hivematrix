"""Streaming VoiceBee turn — the key to "feels live".

Instead of waiting for the whole LLM reply before speaking, we stream the LLM,
chunk it into sentences (streaming.iter_sentences), and TTS each sentence as soon
as it completes. Audio starts after the FIRST sentence, so time-to-first-audio
(TTFA) is roughly STT + first-sentence-LLM + first-sentence-TTS — not the full
reply. `token_stream_fn` is injected so tests can stub the LLM.

Run a real measurement:  .venv/bin/python stream_turn.py <audio-file>
"""
import sys
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable, List, Optional

from streaming import iter_sentences
from stt import transcribe
from tts import synthesize


@dataclass
class StreamTurnResult:
    transcript: str
    sentences: List[str] = field(default_factory=list)
    audio_paths: List[str] = field(default_factory=list)
    stt_s: float = 0.0
    ttfa_s: Optional[float] = None   # end-of-speech → first audio ready
    total_s: float = 0.0


def stream_turn(audio_in: str,
                token_stream_fn: Callable[[str], Iterable[str]],
                on_audio: Optional[Callable[[str], None]] = None,
                stt_model: Optional[str] = None,
                tts_quality: str = "fast") -> StreamTurnResult:
    start = time.time()
    transcript = transcribe(audio_in, model=stt_model)
    stt_s = time.time() - start
    res = StreamTurnResult(transcript=transcript, stt_s=stt_s)
    if not transcript:
        res.total_s = time.time() - start
        return res

    for sentence in iter_sentences(token_stream_fn(transcript)):
        wav = synthesize(sentence, quality=tts_quality)
        if res.ttfa_s is None:
            res.ttfa_s = time.time() - start
        res.sentences.append(sentence)
        res.audio_paths.append(wav)
        if on_audio:
            on_audio(wav)
    res.total_s = time.time() - start
    return res


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: stream_turn.py <audio-file>", file=sys.stderr)
        raise SystemExit(2)
    from llm import LocalLLM
    llm = LocalLLM()
    r = stream_turn(sys.argv[1], llm.respond_stream)
    print("TRANSCRIPT:", r.transcript)
    print("SENTENCES :", r.sentences)
    print(f"STT_s   : {r.stt_s:.2f}")
    print(f"TTFA_s  : {r.ttfa_s:.2f}" if r.ttfa_s is not None else "TTFA_s  : (none)")
    print(f"TOTAL_s : {r.total_s:.2f}")
