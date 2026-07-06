#!/usr/bin/env python3
"""Voice-to-email prototype — capture mic, transcribe, confirm, send.

Usage:
    python3 voice_email.py                          # push-to-talk: Enter to record, Enter to stop
    python3 voice_email.py --demo "email text"      # no-mic demo with pre-written text

Captures audio from the Mac mic via sounddevice, transcribes with the existing
voice-sidecar STT pipeline (whisper.cpp or HIVE_STT_COMMAND), shows the transcript
for confirmation, then prepares email metadata for the daemon to send.

Integration path:
  Short-term: standalone script, callable from HiveMatrix as a tool/skill
  Medium-term: POST /voice/email endpoint on turn_server.py
  Long-term: Voice Lane email skill via Talk button → daemon mail_send

Requires:
  - sounddevice (already in voice-sidecar/requirements.txt)
  - HIVE_STT_COMMAND or pywhispercpp (existing voice-sidecar deps)
  - The mail_send tool (available in this environment)
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import uuid

# ── Imports with graceful fallback ──────────────────────────────────────────

_HAS_SOUNDDEVICE = False
try:
    import numpy as np
    import sounddevice as sd
    _HAS_SOUNDDEVICE = True
except ImportError:
    pass

# ── Config ──────────────────────────────────────────────────────────────────

SAMPLE_RATE = 16000          # whisper expects 16 kHz
MIN_RECORD_SECS = 0.25       # ignore accidental bumps
MAX_RECORD_SECS = 120        # safety limit

# ── Audio capture ──────────────────────────────────────────────────────────

def record_mic() -> tuple[bytes, int] | None:
    """Record from the default Mac mic until Enter. Returns (WAV bytes, sample_rate)
    or None if nothing audible."""
    if not _HAS_SOUNDDEVICE:
        print("⚠ sounddevice not installed. Install: pip install sounddevice", file=sys.stderr)
        return None

    frames: list[np.ndarray] = []

    def callback(indata, _frames, _time, _status):
        frames.append(indata.copy())

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", callback=callback):
            print("\n🎙  Speak your email. Press Enter to stop recording.", flush=True)
            input()
    except Exception as e:
        print(f"❌ Mic error: {e}", file=sys.stderr)
        print("   (Grant Terminal microphone permission in System Settings → Privacy → Microphone)", file=sys.stderr)
        return None

    if not frames:
        print("(nothing recorded)")
        return None

    audio = np.concatenate(frames, axis=0)
    duration = len(audio) / SAMPLE_RATE
    if duration < MIN_RECORD_SECS:
        print(f"(too short: {duration:.1f}s)")
        return None

    # Encode as WAV bytes
    import wave
    buf = tempfile.SpooledTemporaryFile()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # int16
        w.setframerate(SAMPLE_RATE)
        w.writeframes(audio.tobytes())
    buf.seek(0)
    return buf.read(), SAMPLE_RATE


# ── Transcription ──────────────────────────────────────────────────────────

def transcribe_wav(wav_bytes: bytes) -> str:
    """Transcribe WAV bytes using the voice-sidecar STT pipeline.

    Uses stt.transcribe() (the command-seam) if HIVE_STT_COMMAND is set,
    otherwise tries whisper_stt (pywhispercpp in-process). Falls back to
    macOS `say` + `ffmpeg` for a last-resort path.
    """
    # Write to a temp file for the STT pipeline
    work_dir = tempfile.mkdtemp(prefix="hm-ve-")
    wav_path = os.path.join(work_dir, f"voice-email-{uuid.uuid4().hex}.wav")
    try:
        with open(wav_path, "wb") as f:
            f.write(wav_bytes)

        # Strategy 1: existing voice-sidecar STT via command-seam
        stt_cmd = os.environ.get("HIVE_STT_COMMAND", "").strip()
        if stt_cmd:
            from stt import transcribe as _cmd_transcribe
            print("[voice-email] using HIVE_STT_COMMAND...", flush=True)
            return _cmd_transcribe(wav_path)

        # Strategy 2: pywhispercpp in-process
        try:
            from whisper_stt import transcribe_whisper
            print("[voice-email] using whisper.cpp (in-process)...", flush=True)
            return transcribe_whisper(wav_path)
        except ImportError:
            pass

        # Strategy 3: whisper.cpp CLI fallback
        whisper_cli = os.path.expanduser("~/.hivematrix/bin/whisper")
        if os.path.exists(whisper_cli):
            print(f"[voice-email] using whisper CLI at {whisper_cli}...", flush=True)
            result = subprocess.run(
                [whisper_cli, "--language", "en", "--output-txt", wav_path],
                capture_output=True, text=True, timeout=300
            )
            txt_path = wav_path.rsplit(".", 1)[0] + ".txt"
            if os.path.exists(txt_path):
                with open(txt_path) as f_txt:
                    return f_txt.read().strip()

        print("[voice-email] ⚠ no STT backend configured — transcript unavailable", flush=True)
        return ""

    finally:
        # Clean up
        try:
            for entry in os.listdir(work_dir):
                os.remove(os.path.join(work_dir, entry))
            os.rmdir(work_dir)
        except OSError:
            pass


# ── Email intent parsing ───────────────────────────────────────────────────

def parse_email_intent(transcript: str) -> tuple[str, str, str] | None:
    """Very rough intent parsing from the transcript.

    Looks for patterns like:
      "email [recipient] about [subject] ... [body]"
      "send email to [recipient] saying [body]"
      "email [recipient], [body]"

    Returns (to, subject, body) or None to fall back to prompting.
    """
    import re
    t = transcript.lower().strip()

    to = ""
    subject = ""
    body = transcript

    for prefix in ["send email to ", "email to ", "email "]:
        if t.startswith(prefix):
            after = t[len(prefix):].strip()
            # Find 'about' or 'saying' keyword positions
            kw_positions = [
                (after.find(' about '), 'about'),
                (after.find(' saying '), 'saying'),
            ]
            kw_positions = [(p, kw) for p, kw in kw_positions if p >= 0]

            if kw_positions:
                kw_pos, kw_type = min(kw_positions, key=lambda x: x[0])
                to = after[:kw_pos].strip()
                rest = after[kw_pos:].strip()
                if kw_type == 'about':
                    rest = rest[6:].strip()  # remove 'about '
                    m2 = re.match(r'([^.!?]+[.!?])', rest)
                    if m2:
                        subject = m2.group(1).strip()
                        body = rest[m2.end():].strip()
                    else:
                        subject = rest
                        body = ''
                else:  # saying
                    rest = rest[7:].strip()
                    body = rest
            else:
                # No keyword — entire 'after' is the recipient name
                to = after.strip()
                if ',' in after:
                    parts = after.split(',', 1)
                    to = parts[0].strip()
                    body = parts[1].strip()
                else:
                    body = ''
            break

    if to:
        return (to, subject, body)
    return None


# ── Confirmation prompt ───────────────────────────────────────────────────

ConfirmResult = tuple[str, str, str, str]  # (to, subject, body, sendMode)
"""sendMode is 'send' or 'draft'."""

def confirm_send(transcript: str, to: str, subject: str) -> ConfirmResult | None:
    """Interactive confirmation. Returns (to, subject, body, sendMode) or None to cancel."""
    print(f"\n📝 Transcript:\n  {transcript}\n")

    # Prompt for recipient if not parsed
    if not to:
        to = input("  To: ").strip()
        if not to:
            return None

    # Prompt for subject if not parsed
    if not subject:
        subject = input("  Subject: ").strip()
        if not subject:
            return None

    # Show body (allow edit)
    print(f"  Body:\n    {transcript}")
    print("\n  Options: [s]end  [d]raft  [e]dit body  [c]hange recipient  [a]bort")
    choice = input("  Action (s/d/e/c/a): ").strip().lower()

    if choice == "s":
        return (to, subject, transcript, "send")
    elif choice == "d":
        return (to, subject, transcript, "draft")
    elif choice == "e":
        new_body = input("  New body: ").strip()
        if new_body:
            return (to, subject, new_body, "send")
        return None
    elif choice == "c":
        new_to = input("  New recipient: ").strip()
        if new_to:
            return (new_to, subject, transcript, "send")
        return None
    else:
        return None


# ── Main ───────────────────────────────────────────────────────────────────

def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Voice-to-email prototype")
    ap.add_argument("--demo", help="No-mic demo: use this text as transcript")
    args = ap.parse_args()

    print("=" * 60)
    print("📧 Voice Email — HiveMatrix/Weaver Prototype")
    print("=" * 60)

    # Step 1: Get transcript
    if args.demo:
        transcript = args.demo
        print(f"\n📝 Demo transcript: {transcript}")
    else:
        recording = record_mic()
        if recording is None:
            print("No audio captured. Exiting.")
            return 1
        wav_bytes, rate = recording
        print(f"🎙  Recorded {len(wav_bytes):,} bytes ({len(wav_bytes) / rate:.1f}s)", flush=True)

        transcript = transcribe_wav(wav_bytes)
        if not transcript:
            print("(silent or no STT backend)")
            return 1

    # Step 2: Parse intent
    parsed = parse_email_intent(transcript)
    if parsed:
        to, subject, body = parsed
        print(f"  → Parsed recipient: {to}")
        if subject:
            print(f"  → Parsed subject: {subject}")
    else:
        to, subject = "", ""

    # Step 3: Confirm
    result = confirm_send(transcript, to, subject)
    if result is None:
        print("\n🚫 Cancelled.")
        return 0

    to_final, subject_final, body_final, send_mode = result

    # Step 4: Emit instructions for the daemon
    print("\n" + "=" * 60)
    print(f"✅ Email ready to {send_mode}!")
    print(f"  To:      {to_final}")
    print(f"  Subject: {subject_final}")
    print(f"  Body:    {body_final[:200]}{'…' if len(body_final) > 200 else ''}")
    print("\n" + "=" * 60)
    print("📋 Integration note:")
    print("  The daemon's outbox watcher will pick this up and call")
    print("  sendMail / draftMail accordingly.")
    print("=" * 60)

    # Write the email metadata to a temp JSON so the daemon can pick it up
    import json
    out = {
        "to": to_final,
        "subject": subject_final,
        "body": body_final,
        "timestamp": time.time(),
        "source": "voice-email",
        "sendMode": send_mode,
    }
    out_dir = os.path.expanduser("~/.hivematrix/voice-email-outbox")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"email-{uuid.uuid4().hex}.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n📄 Wrote email metadata to {out_path}")
    print("  The daemon's outbox watcher can pick this up and call mail_send.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
