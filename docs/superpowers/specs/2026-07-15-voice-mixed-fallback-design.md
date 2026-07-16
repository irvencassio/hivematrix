# Voice Reply Mixed-Voice Fallback — Design

## Context

Self-improvement dispatch (2026-07-15, ~9pm), flagged as the primary issue to
investigate: "Operator reports receiving 2 different voices on longer
responses." Framed as possibly a model-switching issue (local Qwen ↔
frontier), a tone/personality drift, or an agent-rotation artifact.

Checked `~/_GD/brain/projects/hive/known-issues.md` and brain-searched
("voice two different voices kokoro say fallback") first — no prior report or
fix exists for this. Genuinely new.

## Investigation

"Voice" here is ambiguous on its face (audio TTS engine vs. writing
tone/personality), so traced the actual audio pipeline rather than assuming.
HiveMatrix's voice architecture is intentionally single-voice: Kokoro-82M
(`af_heart`) is "the" live voice everywhere a spoken reply is produced
(`voice-sidecar/tts.py:1-13`); macOS `say` exists **only** as a last-resort
engine "when Kokoro is unavailable... so a turn is never left silent... It is
not a selectable voice." `synthesizeReplyVoice` (`src/lib/voice/turn-server.ts:163`)
is the single call-site every reply-voicing path shares (push-to-talk `/turn`,
the main streaming chat reply in `server.ts:3494`, command/skill turns in
`command-turn.ts`/`skill-turn.ts`, Flash's `flash-mcp.ts`) — so whatever
causes 2 voices has to live below that shared chokepoint, not in per-surface
logic. That rules out "different agents" as the mechanism (there's only one
voicing code path, not several).

Root cause, found by reading `voice-sidecar/tts.py`'s own comments against its
control flow: `mlx-audio`'s `generate_audio` (the Kokoro backend) crashes
(`broadcast_shapes`) whenever one call is asked to produce more than one
"segment" — so `_synthesize_kokoro` (`tts.py:193-237`) is forced to split any
multi-sentence reply into one Kokoro call per sentence
(`_split_for_synth`, `tts.py:157-158`) and concatenate the resulting WAVs.
Each sentence gets up to 4 Kokoro attempts (1 normal + padding + 3 retry
speeds, `_kokoro_run_padded`, `tts.py:173-190`) to dodge a *second*,
length-dependent variant of the same mlx-audio crash that can still hit a
single sentence. **When all 4 attempts for one specific sentence still fail,
the per-chunk loop (`tts.py:212-225`, prior to this fix) silently substitutes
a macOS `say`-rendered chunk for *that one sentence* and concatenates it with
the neighboring Kokoro chunks** — the code comment even says so: "only the
rare failing sentence changes voice." The result is a single reply audio file
that is audibly Kokoro for most of it and the system `say` voice for one
sentence in the middle or end.

This exactly matches the report's shape:
- **Only possible on multi-sentence replies.** `len(chunks) <= 1` (a short,
  single-sentence reply) is all-or-nothing — it either fully succeeds in
  Kokoro or the whole `_synthesize_kokoro` call raises and the existing
  top-level fallback in `synthesize()` (`tts.py:64-71`) re-voices the *entire*
  text in `say`, one consistent voice either way. A "mixed" single output is
  structurally impossible below that chunk count. Multi-sentence ("longer")
  replies are the *only* case where a partial per-chunk substitution can even
  occur — matching "on longer responses" precisely, not coincidentally.
- **Not model switching, not tone drift, not agent rotation.** One shared
  voicing chokepoint, one TTS engine choice (Kokoro) with one silent
  last-resort engine (`say`) — the "2 voices" are literally two different TTS
  engines rendering different sentences of the same reply, not two LLMs or
  two personas.

Confirmed this isn't already fixed: `git log -S"_synthesize_say(chunk"
-- voice-sidecar/tts.py` and `git blame` show this per-chunk substitution as
the current, unmodified logic at HEAD (`e2fe0cc8`, released 0.1.208). No
open worktree or plan doc touches it.

## Non-Goals

- Not attempting to fix the underlying `mlx-audio` `broadcast_shapes` crash
  itself — that's a third-party library bug (already worked around once, via
  the sentence-splitting itself). Out of reach from this repo.
- Not adding a new retry strategy beyond the existing 4 attempts
  (`_SYNTH_RETRY_SPEEDS`) — no evidence the current retry budget is
  insufficient in a way more speeds would fix; the failure this design
  addresses is what happens *after* retries are exhausted, not the retry
  logic itself.
- Not changing `synthesize()`'s existing top-level whole-text fallback
  contract (Kokoro fully, or `say` fully) — extending that same contract to
  the per-chunk path is precisely the fix, not a new concept (Complexity
  Budget: reuse, don't re-roll).
- No release/build/publish step. Operator releases.

## Approaches

**A. Whole-reply fallback on any chunk failure (propagate, don't patch).**
When a chunk exhausts all Kokoro attempts, discard any already-synthesized
sibling chunks (temp WAVs) and raise, instead of substituting a `say` chunk
and continuing. `synthesize()`'s existing catch-all (`tts.py:66-71`) already
re-voices the *entire original text* via `_synthesize_say` on any exception
from `_synthesize_kokoro` — so this requires no new fallback logic, just
removing the special case that currently swallows the failure inside the
loop. Net effect: a reply is either fully Kokoro or fully `say`, never mixed.
Net *fewer* lines (deletes the per-chunk try/except + `traceback.print_exc`
substitution block) — a simplification, not an addition.

**B. Keep per-chunk substitution, but pick a `say` voice closer to Kokoro's
timbre.** Rejected: doesn't fix the actual complaint (still audibly 2 engines
switching mid-reply, just less jarring), adds a voice-matching problem with
no clean solution (macOS `say` voices don't imitate Kokoro), and treats the
symptom instead of the cause.

**C. Drop the failing sentence silently instead of substituting anything.**
Rejected: reintroduces the exact bug the per-chunk fallback was *originally*
written to avoid (the comment: "Rather than drop that sentence from the
reply") — the operator would sometimes hear an incomplete reply with no
indication a sentence went missing. Worse than the current bug, not better.

## Recommendation

**A.** Smallest correct change, deletes code rather than adding it, reuses
the existing whole-text fallback contract instead of inventing a second one,
and directly removes the mechanism that produces 2 voices in one reply. The
`_KOKORO_SR` constant (`tts.py:163`, "the per-sentence say fallback below is
rendered at the same rate") becomes dead once the per-chunk `say` call is
removed — delete it too rather than leaving an unused constant.

Trade-off accepted: a reply with 9 good sentences and 1 mlx-audio-crashing
sentence now renders *all 10* in `say` rather than 9-in-Kokoro-1-in-say. Given
the failure is describe-as-rare (a specific phoneme-length crash surviving 4
retry attempts) and the alternative is an audibly broken reply every time it
happens, whole-reply consistency is the better default. If live use shows
whole-reply `say` fallback firing often enough to matter, that's a signal to
revisit `_SYNTH_RETRY_SPEEDS` (Non-Goals), not to reintroduce mixing.

## Verification

```
python3 voice-sidecar/test_tts_split.py     # existing, must stay green
python3 voice-sidecar/test_tts_fallback.py  # new — see plan
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

New test must mock `_kokoro_run`/`_kokoro_run_padded` (no real model load,
matching `test_tts_split.py`'s no-model-load style) to deterministically
force one chunk's exhaustion and assert: (a) the final output is produced
entirely via the `say` path (no `_concat_wavs` of mixed-engine parts), (b)
no partial Kokoro temp files are left on disk after the fallback.

No release/build/publish step. Operator releases.
