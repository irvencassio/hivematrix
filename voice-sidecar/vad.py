"""Energy + silence-hangover VAD for live (hands-free) voice mode (P3 realtime).

`talk.py` is push-to-talk (press Enter). Live mode needs the machine to decide
when you start and stop talking. This is that decision, as a PURE streaming state
machine: push one frame's energy (RMS) at a time, get a boundary event back
("start" / "end"). No numpy, no audio device, no I/O — so it's unit-tested
deterministically. `live.py` computes per-frame RMS from the mic and feeds it
here; the same "start" event, seen while the assistant is speaking, is the
barge-in trigger.

Tuning (defaults assume 16 kHz, 20 ms frames):
  start_rms > end_rms gives hysteresis so a voice hovering near the threshold
  doesn't flap. start_frames debounces brief noise spikes into a real "start".
  hang_frames is the end-of-turn silence (25 * 20 ms = 0.5 s).
"""
from dataclasses import dataclass
from typing import Optional
import math


def frame_rms(samples) -> float:
    """RMS amplitude of int16 PCM samples (numpy array or any int sequence).

    Range ~0..32768. Uses numpy when available (fast for real mic frames), with a
    dependency-free fallback so the math is usable anywhere.
    """
    try:
        import numpy as np  # noqa: PLC0415 — optional fast path
        a = np.asarray(samples, dtype=np.float64).ravel()
        if a.size == 0:
            return 0.0
        return float(np.sqrt(np.mean(a * a)))
    except Exception:
        vals = list(samples)
        if not vals:
            return 0.0
        return math.sqrt(sum(float(v) * float(v) for v in vals) / len(vals))


@dataclass
class VadSegmenter:
    start_rms: float = 500.0   # frame RMS at/above this counts as voiced
    end_rms: float = 350.0     # frame RMS below this counts as silence (end < start)
    start_frames: int = 3      # consecutive voiced frames to declare a speech "start"
    hang_frames: int = 25      # consecutive silent frames to declare a speech "end"

    def __post_init__(self):
        self._speaking = False
        self._voiced_run = 0
        self._silent_run = 0

    @property
    def speaking(self) -> bool:
        return self._speaking

    def reset(self) -> None:
        self._speaking = False
        self._voiced_run = 0
        self._silent_run = 0

    def push_rms(self, rms: float) -> Optional[str]:
        """Feed one frame's RMS; return 'start' or 'end' on a boundary, else None."""
        if not self._speaking:
            if rms >= self.start_rms:
                self._voiced_run += 1
                if self._voiced_run >= self.start_frames:
                    self._speaking = True
                    self._voiced_run = 0
                    self._silent_run = 0
                    return "start"
            else:
                self._voiced_run = 0
            return None

        # speaking: wait for a sustained run of silence to end the turn
        if rms < self.end_rms:
            self._silent_run += 1
            if self._silent_run >= self.hang_frames:
                self._speaking = False
                self._voiced_run = 0
                self._silent_run = 0
                return "end"
        else:
            self._silent_run = 0
        return None
