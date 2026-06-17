"""Headless proof of the live-mode VAD state machine (vad.py).

Pure floats, no device — run anywhere: python3 test_vad.py
"""
import sys

from vad import VadSegmenter, frame_rms


def feed(seg, rms, n):
    """Push `n` frames of constant `rms`; return the list of non-None events."""
    return [e for e in (seg.push_rms(rms) for _ in range(n)) if e]


def test_silence_stays_idle():
    seg = VadSegmenter()
    assert feed(seg, 0.0, 100) == []
    assert seg.speaking is False


def test_start_after_debounce_then_end_after_hang():
    seg = VadSegmenter(start_frames=3, hang_frames=5)
    # First two voiced frames: not yet a start (debounce).
    assert seg.push_rms(1000) is None
    assert seg.push_rms(1000) is None
    # Third crosses the start threshold.
    assert seg.push_rms(1000) == "start"
    assert seg.speaking is True
    # More speech: no event.
    assert feed(seg, 1000, 10) == []
    # Silence shorter than hang: still speaking.
    assert seg.push_rms(0) is None
    assert seg.push_rms(0) is None
    assert seg.speaking is True
    # Reach hang_frames total of silence (5): end fires.
    assert seg.push_rms(0) is None
    assert seg.push_rms(0) is None
    assert seg.push_rms(0) == "end"
    assert seg.speaking is False


def test_short_blip_does_not_start():
    seg = VadSegmenter(start_frames=3)
    assert seg.push_rms(2000) is None  # 1 voiced
    assert seg.push_rms(2000) is None  # 2 voiced
    assert seg.push_rms(0) is None     # silence resets the run
    assert seg.push_rms(2000) is None  # back to 1 voiced — no start
    assert seg.speaking is False


def test_brief_dip_during_speech_does_not_end():
    seg = VadSegmenter(start_frames=1, hang_frames=4)
    assert seg.push_rms(1000) == "start"
    assert seg.push_rms(0) is None     # 1 silent
    assert seg.push_rms(0) is None     # 2 silent
    assert seg.push_rms(1000) is None  # voiced resets the silence run
    assert feed(seg, 0, 3) == []       # 3 silent — still < hang (4)
    assert seg.speaking is True


def test_hysteresis_mid_band_does_not_flap():
    # RMS between end_rms and start_rms while idle = not a start.
    seg = VadSegmenter(start_rms=500, end_rms=350, start_frames=2)
    assert feed(seg, 400, 20) == []
    assert seg.speaking is False


def test_reset():
    seg = VadSegmenter(start_frames=1)
    assert seg.push_rms(1000) == "start"
    seg.reset()
    assert seg.speaking is False
    assert seg.push_rms(1000) == "start"


def test_frame_rms():
    assert frame_rms([]) == 0.0
    assert frame_rms([0, 0, 0]) == 0.0
    # constant amplitude → that amplitude
    assert abs(frame_rms([100, -100, 100, -100]) - 100.0) < 1e-9


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("vad tests passed")
    sys.exit(0)
