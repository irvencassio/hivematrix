"""Unit tests for tts._split_for_synth — the sentence splitter that keeps each
Kokoro pass to a single segment (mlx-audio crashes when one call produces more
than one segment, which dropped everything after the first paragraph). Pure
string logic; does not load Kokoro. Run: python3 test_tts_split.py
"""
import sys

from tts import _split_for_synth


def check(name, got, want):
    assert got == want, f"{name}: got {got!r}, want {want!r}"
    print(f"ok: {name}")


def main() -> int:
    check("single sentence", _split_for_synth("Just one sentence here."),
          ["Just one sentence here."])
    check("empty", _split_for_synth(""), [])
    check("whitespace only", _split_for_synth("   \n  "), [])
    check("multi-sentence one line",
          _split_for_synth("One. Two! Three?"),
          ["One.", "Two!", "Three?"])
    check("paragraph breaks split too",
          _split_for_synth("First para line.\n\nSecond para line."),
          ["First para line.", "Second para line."])
    check("ellipsis is a boundary",
          _split_for_synth("Well… okay then."),
          ["Well…", "okay then."])
    # No sentence is ever merged with another (that is what triggers the mlx crash).
    goals = ("My first goal is to ship. This is the priority.\n\n"
             "My second goal is revenue. That funds the runway.")
    parts = _split_for_synth(goals)
    assert len(parts) == 4, f"expected 4 one-sentence chunks, got {len(parts)}: {parts}"
    assert all(p.count(".") <= 1 for p in parts), f"a chunk holds >1 sentence: {parts}"
    print("ok: multi-paragraph splits to one sentence per chunk")
    print("\nALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
