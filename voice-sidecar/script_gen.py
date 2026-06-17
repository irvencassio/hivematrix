#!/usr/bin/env python3
"""Draft a video voiceover script from a topic, with the local LLM (Phase 4, P4.1).

The "invest in the script, automate the production" idea — the local Qwen writes
a first draft you then edit. Outputs plain narration (no headings/markdown) ready
for make.mjs. Supports the same languages as the rest of the pipeline.

    python script_gen.py --topic "how to add a task in HiveMatrix" --lang it --seconds 30 --out script.txt
"""
import argparse
import sys

from llm import LocalLLM

LANG_NAMES = {"en": "English", "it": "Italian", "es": "Spanish", "fr": "French", "de": "German"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", required=True)
    ap.add_argument("--lang", default="en")
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--out")
    a = ap.parse_args()

    lang_name = LANG_NAMES.get(a.lang, a.lang)
    target_words = max(20, round(a.seconds * 2.3))  # ~2.3 spoken words/sec
    system = (
        "You are a scriptwriter for short how-to videos. Output ONLY the voiceover "
        "narration — no titles, no scene directions, no markdown, no emojis, no quotes. "
        "Use a natural spoken style with short, clear sentences. "
        f"Write in {lang_name}. Aim for about {target_words} words (~{a.seconds} seconds)."
    )
    user = f"Write the voiceover script for a how-to video about: {a.topic}"
    script = LocalLLM().respond(user, system=system).strip()
    if not script:
        print("script_gen: empty result (is reasoning OFF in LM Studio?)", file=sys.stderr)
        return 1

    if a.out:
        with open(a.out, "w") as f:
            f.write(script + "\n")
        print(a.out)
    else:
        print(script)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
