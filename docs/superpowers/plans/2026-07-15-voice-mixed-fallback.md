# Voice Reply Mixed-Voice Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-voice-mixed-fallback-design.md`

Single file touched (`voice-sidecar/tts.py`) plus one new test file — one task,
one subagent.

## Task 1 — Stop per-chunk `say` substitution; propagate to the existing whole-reply fallback

File: `voice-sidecar/tts.py`, function `_synthesize_kokoro` (currently
~line 193-237). Also touches module-level constant `_KOKORO_SR` (~line 163,
confirmed via `grep -rn "_KOKORO_SR" voice-sidecar/*.py` to have exactly one
other reference — the one being deleted).

- [ ] **Red:** Create `voice-sidecar/test_tts_fallback.py`, matching
  `test_tts_split.py`'s exact style (plain script, no pytest, a `check()`
  helper, `main()` returning 0/1, `python3 test_tts_fallback.py` runnable
  standalone, **no real model load**). Monkeypatch `tts._kokoro_run_padded`
  and `tts._synthesize_say` (both module-level functions tts.py already
  defines) so no test loads mlx-audio or shells out to `say`:

  ```python
  """Unit tests for tts._synthesize_kokoro's multi-chunk fallback behavior —
  a mid-reply Kokoro failure must re-voice the WHOLE reply in one consistent
  engine, never patch a different-engine chunk into an otherwise-Kokoro reply.
  Mocks _kokoro_run_padded/_synthesize_say; does not load Kokoro or shell to
  `say`. Run: python3 test_tts_fallback.py
  """
  import os
  import sys
  import tempfile

  import tts


  def check(name, cond, detail=""):
      assert cond, f"{name}: {detail}"
      print(f"ok: {name}")


  def test_all_chunks_succeed_no_say_call(tmp_out):
      calls = []
      def fake_kokoro(text, out_path, voice, speed=1.0):
          calls.append(text)
          with open(out_path, "wb") as f:
              f.write(b"RIFF....WAVEfmt ")  # placeholder, never read as real audio
          return out_path
      def fake_say(*a, **kw):
          raise AssertionError("say must not be called when all chunks succeed")
      orig_kr, orig_say = tts._kokoro_run_padded, tts._synthesize_say
      tts._kokoro_run_padded, tts._synthesize_say = fake_kokoro, fake_say
      try:
          # _concat_wavs needs real WAV frames for >1 part; use a single-sentence
          # text here so this test only exercises the "no failure" path via the
          # multi-chunk loop's success branch (len(chunks) > 1 still hits the
          # per-chunk loop even if each succeeds) — use a 2-sentence text and
          # monkeypatch _concat_wavs too, since we only care THIS test never
          # calls the say path, not the audio bytes.
          tts._concat_wavs = lambda parts, out: open(out, "wb").write(b"ok")
          result = tts._synthesize_kokoro("First one. Second one.", tmp_out, None)
          check("returns out_path", result == tmp_out)
          check("both chunks hit kokoro", calls == ["First one.", "Second one."])
      finally:
          tts._kokoro_run_padded, tts._synthesize_say = orig_kr, orig_say


  def test_one_chunk_fails_raises_not_mixes(tmp_out):
      """The bug this fixes: chunk 2 of 3 exhausts all Kokoro attempts. Old
      behavior silently patched a `say` chunk into the concatenated output.
      New behavior must raise so the caller's whole-text `say` fallback
      (tts.synthesize's try/except) re-voices the ENTIRE reply consistently."""
      say_calls = []
      def fake_kokoro(text, out_path, voice, speed=1.0):
          if text == "Second fails.":
              return None  # simulates exhausting all 4 attempts
          with open(out_path, "wb") as f:
              f.write(b"placeholder")
          return out_path
      def fake_say(*a, **kw):
          say_calls.append(a)
          raise AssertionError("per-chunk say substitution must not happen")
      orig_kr, orig_say = tts._kokoro_run_padded, tts._synthesize_say
      tts._kokoro_run_padded, tts._synthesize_say = fake_kokoro, fake_say
      try:
          raised = False
          try:
              tts._synthesize_kokoro("First ok. Second fails. Third ok.", tmp_out, None)
          except RuntimeError:
              raised = True
          check("raises instead of substituting", raised)
          check("never called per-chunk say", say_calls == [])
          check("no output file left behind", not os.path.exists(tmp_out))
      finally:
          tts._kokoro_run_padded, tts._synthesize_say = orig_kr, orig_say


  def test_no_orphaned_temp_segments(tmp_out):
      """When chunk 2 fails after chunk 1 already succeeded, chunk 1's temp
      segment WAV must be cleaned up, not leaked."""
      def fake_kokoro(text, out_path, voice, speed=1.0):
          if text == "Second fails.":
              return None
          with open(out_path, "wb") as f:
              f.write(b"placeholder")
          return out_path
      orig_kr = tts._kokoro_run_padded
      tts._kokoro_run_padded = fake_kokoro
      try:
          try:
              tts._synthesize_kokoro("First ok. Second fails.", tmp_out, None)
          except RuntimeError:
              pass
          out_dir = os.path.dirname(tmp_out) or "."
          base = os.path.splitext(os.path.basename(tmp_out))[0]
          leftover = [f for f in os.listdir(out_dir) if f.startswith(f"{base}__seg")]
          check("no leftover segment files", leftover == [], detail=str(leftover))
      finally:
          tts._kokoro_run_padded = orig_kr


  def main() -> int:
      with tempfile.TemporaryDirectory() as d:
          out = os.path.join(d, "reply.wav")
          test_all_chunks_succeed_no_say_call(out)
          test_one_chunk_fails_raises_not_mixes(out)
          test_no_orphaned_temp_segments(out)
      print("\nALL PASSED")
      return 0


  if __name__ == "__main__":
      sys.exit(main())
  ```

  Run `python3 voice-sidecar/test_tts_fallback.py` and confirm
  `test_one_chunk_fails_raises_not_mixes` and `test_no_orphaned_temp_segments`
  **fail** against current code (current code catches the `None` from
  `fake_kokoro` and calls `_synthesize_say` per-chunk instead of raising —
  the test's `fake_say` will assert-fail, proving the red state).

- [ ] **Green:** In `voice-sidecar/tts.py`, replace the per-chunk loop body
  (current lines ~212-225) so a chunk that exhausts `_kokoro_run_padded`
  cleans up already-written sibling segments and raises, instead of calling
  `_synthesize_say` inline:

  ```python
  for i, chunk in enumerate(chunks):
      seg = os.path.join(out_dir, f"{base}__seg{i:03d}.wav")
      result = _kokoro_run_padded(chunk, seg, voice)
      if result is None:
          # mlx-audio can crash (broadcast_shapes) on specific phoneme lengths
          # for one sentence even after retries. Don't patch a different
          # engine's chunk in here — that produces one reply audibly split
          # across two voices. Raise so the caller's whole-reply `say`
          # fallback (synthesize()'s try/except) re-voices the ENTIRE text
          # in one consistent voice instead.
          for p in parts:
              try:
                  os.remove(p)
              except OSError:
                  pass
          raise RuntimeError(f"kokoro produced no audio for chunk {i}: {chunk[:80]!r}")
      parts.append(seg)
  ```

  Delete the now-dead `_KOKORO_SR = 24000` constant (~line 163) and its
  preceding comment block — confirmed (grep) it has no other reference after
  this change. Leave the rest of `_synthesize_kokoro` (the `len(parts) == 1`
  / `_concat_wavs` tail) unchanged.

- [ ] Re-run `python3 voice-sidecar/test_tts_fallback.py` — all 3 checks
  pass. Re-run `python3 voice-sidecar/test_tts_split.py` — still green
  (unaffected file, but confirms the module still imports cleanly). Grep
  `voice-sidecar/` once more for `_KOKORO_SR` and `traceback` usage in
  `_synthesize_kokoro` to confirm both are fully gone from that function (the
  `import traceback` at the top of the file is still used elsewhere — e.g.
  `synthesize()`'s own except block — do not remove the import).

## Verification gate (per AGENTS.md)

```
python3 voice-sidecar/test_tts_fallback.py
python3 voice-sidecar/test_tts_split.py
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`qwen-readiness.mts` not required — this is the voice/TTS sidecar, not the
`src/lib/local-model/` Qwen routing path AGENTS.md scopes that gate to.

Manual/live check not possible in this non-interactive session (no audio
playback) — verification relies on the mocked unit tests proving the control
flow (raise-and-propagate, not substitute-and-mix) plus the existing
`test_tts_split.py` proving the splitting behavior this builds on is
unchanged. State this limitation explicitly when reporting completion.

## Out of scope / explicitly not touched

- `mlx-audio`'s underlying `broadcast_shapes` crash — third-party bug, not
  fixable here (Design doc Non-Goals).
- `_SYNTH_RETRY_SPEEDS` / the 4-attempt retry budget before a chunk is
  considered failed — unchanged.
- The top-level `synthesize()` whole-text fallback (`tts.py:52-71`) — already
  correct, this plan makes the per-chunk path consistent with it, not the
  reverse.
- No release/build/publish step. Operator releases.
