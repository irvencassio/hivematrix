#!/usr/bin/env python3
"""Generate YouTube metadata from a video's narration (Phase 4, P4.6).

The local Qwen turns the script into a title, description, and tags. Outputs JSON
for publish.mjs.  python yt_meta.py --script-file script.txt [--lang it] [--out meta.json]
"""
import argparse
import json
import re
import sys

from llm import LocalLLM


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--script-file", dest="script_file", required=True)
    ap.add_argument("--lang", default="en")
    ap.add_argument("--out")
    a = ap.parse_args()

    with open(a.script_file, "r") as f:
        script = f.read().strip()

    system = (
        "You write YouTube metadata. From the video's narration, produce a compelling "
        "title (max 70 chars, no clickbait), a 2-3 sentence description, and 5-8 "
        "lowercase tags. Write in the SAME language as the narration. "
        'Respond with ONLY JSON: {"title": "...", "description": "...", "tags": ["...", "..."]}'
    )
    raw = LocalLLM().respond("Narration:\n" + script, system=system).strip()

    m = re.search(r"\{.*\}", raw, re.S)
    try:
        data = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        data = {}
    data.setdefault("title", script.split(".")[0][:70])
    data.setdefault("description", script[:300])
    data.setdefault("tags", ["hivematrix", "how-to", "tutorial"])

    payload = json.dumps(data, ensure_ascii=False)
    if a.out:
        with open(a.out, "w") as f:
            f.write(payload)
        print(a.out)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
