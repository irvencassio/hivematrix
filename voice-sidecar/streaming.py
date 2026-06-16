"""Sentence chunking for streaming TTS.

As the LLM streams tokens, we want to start speaking the moment the first
sentence is complete — not wait for the whole reply. `iter_sentences` consumes a
token iterator and yields complete sentences as soon as they form, so the caller
can TTS each one immediately (cutting time-to-first-audio).

Pure + deterministic (no I/O) → unit-tested.
"""
import re
from typing import Iterable, Iterator, Optional

# A boundary is . ! or ? (a '.' only when not between digits, so "3.14" / "v1.2"
# don't split), plus any trailing closing quote/bracket.
_BOUNDARY = re.compile(r'(?:(?<!\d)\.(?!\d)|[!?])+["\')\]]*')
# Clause boundaries — used only to start the FIRST chunk sooner (lower TTFA).
_CLAUSE = re.compile(r'[,;:]')


def _next_cut(buf: str, eager: bool, first_min_chars: int) -> Optional[int]:
    m = _BOUNDARY.search(buf)
    sent_end = m.end() if m else None
    if eager and len(buf) >= first_min_chars:
        cm = _CLAUSE.search(buf, first_min_chars)
        if cm and (sent_end is None or cm.end() < sent_end):
            return cm.end()
    return sent_end


def iter_sentences(tokens: Iterable[str], eager_first: bool = True,
                   first_min_chars: int = 18) -> Iterator[str]:
    """Yield speakable chunks from streamed tokens; flush the tail.

    Chunks break on sentence boundaries. With `eager_first`, the FIRST chunk may
    also break at an earlier clause boundary (comma/semicolon/colon) once it has
    `first_min_chars` chars — so audio starts sooner without chopping later
    sentences. Pure + deterministic.
    """
    buf = ""
    emitted = 0
    for tok in tokens:
        buf += tok
        while True:
            cut = _next_cut(buf, eager=(eager_first and emitted == 0),
                            first_min_chars=first_min_chars)
            if cut is None:
                break
            chunk = buf[:cut].strip()
            buf = buf[cut:].lstrip()
            if chunk:
                yield chunk
                emitted += 1
    tail = buf.strip()
    if tail:
        yield tail
