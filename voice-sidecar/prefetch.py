#!/usr/bin/env python3
"""Prefetch the voice/video models so first use is instant (Phase 4 provisioning).

Downloads the model repos into the Hugging Face cache. Run by the provisioning
step right after the venv's deps are installed.
"""
import sys

from huggingface_hub import snapshot_download

REPOS = [
    "mlx-community/VoxCPM2-bf16",  # cloned-voice TTS
]


def main() -> int:
    for repo in REPOS:
        print(f"fetching {repo} …", flush=True)
        try:
            snapshot_download(repo)
            print(f"  ok {repo}", flush=True)
        except Exception as e:  # noqa: BLE001 — report and continue
            print(f"  skip {repo}: {e}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
