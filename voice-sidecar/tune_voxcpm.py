#!/usr/bin/env python3
"""Sweep VoxCPM2 cloning parameters on YOUR reference, so you can pick the best
quality/speed point. Writes labeled WAVs to /tmp/voxcpm_tune and reports latency.

Knobs (mlx-audio → VoxCPM2):
  ddpm_steps  → inference_timesteps  (more = higher quality, slower)
  cfg_scale   → cfg_value (min 2.0)  (higher = stronger voice adherence, can add artifacts)
  temperature                        (lower = more stable/consistent)

    .venv/bin/python tune_voxcpm.py ["sentence to speak"]
    then:  for v in A_fast B_more C_maxq D_strong; do say $v; afplay /tmp/voxcpm_tune/${v}_000.wav; done
"""
import os
import sys
import time

from mlx_audio.tts.generate import generate_audio

PROFILE = os.path.expanduser("~/.hivematrix/voice/profile.wav")
OUT = "/tmp/voxcpm_tune"
MODEL = "mlx-community/VoxCPM2-bf16"

VARIANTS = [
    ("A_fast",   dict(ddpm_steps=10, cfg_scale=2.0, temperature=0.7)),  # baseline
    ("B_more",   dict(ddpm_steps=24, cfg_scale=2.5, temperature=0.6)),  # more steps, a bit more adherence
    ("C_maxq",   dict(ddpm_steps=32, cfg_scale=3.0, temperature=0.5)),  # max quality, stable
    ("D_strong", dict(ddpm_steps=16, cfg_scale=4.0, temperature=0.5)),  # strong voice match
]


def main() -> int:
    if not os.path.isfile(PROFILE):
        print(f"No voice profile at {PROFILE} — run record_voice.py first.")
        return 1
    text = sys.argv[1] if len(sys.argv) > 1 else \
        "Hi, this is my voice running locally. Let me check your calendar for tomorrow."
    os.makedirs(OUT, exist_ok=True)

    for name, params in VARIANTS:
        path = os.path.join(OUT, f"{name}_000.wav")
        try:
            t = time.time()
            generate_audio(text=text, model=MODEL, ref_audio=PROFILE,
                           output_path=OUT, file_prefix=name, audio_format="wav",
                           verbose=False, **params)
            ok = os.path.exists(path) and os.path.getsize(path) > 0
            tag = "ok " if ok else "NO-FILE"
            p = f"steps={params['ddpm_steps']} cfg={params['cfg_scale']} temp={params['temperature']}"
            print(f"[{tag}] {name:9s} {time.time()-t:5.1f}s  {p}")
        except Exception as e:  # noqa: BLE001
            print(f"[err]    {name:9s} {type(e).__name__}: {str(e)[:120]}")

    print(f"\nCompare:  for v in A_fast B_more C_maxq D_strong; do say $v; afplay {OUT}/${{v}}_000.wav; done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
