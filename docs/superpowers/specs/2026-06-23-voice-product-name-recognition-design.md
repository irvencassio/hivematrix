# Voice Product Name Recognition Design

## Context

Voice requests from HiveMatrix-iOS can mis-transcribe branded capability names.
The concrete example is `MessageBee` becoming `message B`, after which
HiveMatrix may fail to route the request to the intended MessageBee channel.

The active push-to-talk path is:

1. HiveMatrix-iOS records microphone audio in `VoiceTalkView`.
2. The iOS client posts base64 audio to `POST /voice/turn`.
3. The daemon relays the audio to the warm sidecar worker.
4. `voice-sidecar/stt.py` runs the configured local STT command.
5. `voice-sidecar/turn_server.py` sends the transcript to the local LLM/tool path.

This means the first practical fix should live in the Mac daemon/sidecar path,
not in the iOS UI alone. The iOS app currently sends audio, not a prebuilt
Apple Speech transcript.

## Research Notes

- Apple Speech supports app-specific vocabulary. `contextualStrings` can bias
  recognition toward custom app phrases, and iOS 17+ custom language model work
  can boost specialized terminology, product names, and phrases on device.
- HiveMatrix is not currently using Apple Speech for push-to-talk
  transcription. The current path sends audio to the Mac daemon, which delegates
  STT to the configured local command.
- Some STT backends support a spelling guide or custom vocabulary. When the
  chosen backend supports it, HiveMatrix should pass a small product vocabulary
  such as `HiveMatrix, MessageBee, MailBee, BrowserBee, DesktopBee, VoiceBee`.
- STT hints are rarely hard constraints. Post-processing with a canonical
  spelling list is the more scalable and deterministic backstop.
- HiveMatrix already has a deterministic voice intent pattern in
  `src/lib/voice/skill-intent.ts`: parse the transcript, match known names, and
  return structured handling before relying on an LLM guess. Product names can
  use the same pattern.

Sources:

- Apple Developer: `SFSpeechRecognitionRequest.contextualStrings`
  https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/contextualstrings
- Apple WWDC23: Customize on-device speech recognition
  https://developer.apple.com/videos/play/wwdc2023/10101/

## Goals

1. Spoken HiveMatrix product/capability names should resolve to the right
   canonical name even when STT outputs common homophones or spaced variants.
2. The fix should work for push-to-talk, live voice session handoff, and future
   phone voice.
3. The canonical names shown in UI/docs can change independently from spoken
   aliases.
4. Avoid broad brand churn unless the voice error rate stays high after
   normalization.
5. Keep the solution local-first and testable without requiring live microphone
   recordings for every case.

## Non-Goals

- Do not rename every Bee lane as the first move.
- Do not make the local LLM guess whether `message B` means `MessageBee`.
- Do not add cloud STT as a dependency.
- Do not block future product naming work; aliases should support both old and
  new names during any transition.

## Approach A: Canonical Voice Alias Layer

Add a small shared module, likely `src/lib/voice/product-aliases.ts`, with:

- canonical product names: `MessageBee`, `MailBee`, `BrowserBee`, `DesktopBee`,
  `VoiceBee`, `WebBee`, `TermBee`, `TraderBee`, `HiveMatrix`.
- spoken aliases and observed mistranscriptions: `message bee`, `message b`,
  `messages bee`, `messaging bee`, `mail b`, `browser b`, `desktop b`, etc.
- a normalizer that rewrites only high-confidence phrase matches.
- metadata describing whether a match is exact, alias, or ambiguous.

Use it in:

- `voice-sidecar/turn_server.py`, before `LocalLLM().respond_with_tools`.
- `src/lib/voice/session.ts`, before rendering task descriptions.
- optional future `/voice/aliases` endpoint so iOS can display or preload the
  same vocabulary.

This is the recommended baseline because it is deterministic, cheap, and does
not force a public rename.

## Approach B: STT Spelling Guide

When the configured STT backend supports vocabulary hints, pass a compact
spelling guide. Example:

```text
HiveMatrix product names include MessageBee, MailBee, BrowserBee, DesktopBee,
VoiceBee, WebBee, TermBee, TraderBee, and HiveMatrix.
```

This should reduce misses before they happen, especially capitalization and
word-boundary errors. It should not be the only defense because vocabulary hints
are backend-specific and may not be hard constraints.

Best use: pair it with Approach A. Prompting improves the raw transcript;
aliases guarantee canonical routing when the transcript still says `message B`.

## Approach C: Product Rename / Spoken Brand Pass

If the brand family itself is the problem, rename the public-facing product
labels to words that dictation naturally recognizes. Keep internal tool names
stable for compatibility while UI/docs expose the friendlier spoken name.

Possible directions:

- `MessageBee` -> `Messages`, `Text Lane`, `Texting`, `Hive Text`, or
  `Message Hub`.
- `MailBee` -> `Mail`, `Email`, `Inbox`, or `Mail Lane`.
- `VoiceBee` -> `Voice`, `Talk`, or `Hive Voice`.
- `BrowserBee` -> `Browser`, `Web Runner`, or `Web Agent`.
- `DesktopBee` -> `Desktop`, `Mac Control`, or `Mac Agent`.

Recommended naming rule: prefer plain nouns for voice commands and reserve
`Bee` names for internal implementation or playful secondary labels. For
example, the UI can say `Texting` while the internal capability remains
`messagebee_send`.

## Recommended Design

Use a layered fix:

1. Add canonical voice aliases for all current capability names.
2. Feed the canonical names into Whisper via `initial_prompt`.
3. Add transcript repair before LLM/tool routing and before voice-session task
   creation.
4. Record observed repairs in the returned voice result, for example
   `{ transcript, normalizedTranscript, replacements }`, so the UI can show what
   HiveMatrix heard and what it meant.
5. Keep public renaming as a product polish pass after collecting a short corpus
   of real misrecognitions.

This lets the user keep saying `MessageBee`, `message bee`, or even `message B`
without breaking the command. It also supports a future rename because aliases
can map both old and new spoken names to the same canonical capability.

## Suggested Evaluation Corpus

Start with unit tests for transcript-only normalization:

- `use MessageBee to text Sarah`
- `use message bee to text Sarah`
- `use message B to text Sarah`
- `ask MailBee to draft a reply`
- `open desktop B and click the button`
- `use browser bee to research this`
- `talk to VoiceBee`
- `message be John` should be low-confidence unless command context confirms it.

Then add a tiny live-audio smoke set once implementation exists:

- Record each phrase from iOS push-to-talk.
- Confirm raw transcript, normalized transcript, and final tool/capability route.
- Run normal repo gates. Because this touches voice and possibly local-model
  routing, include `npx tsx scripts/qwen-readiness.mts`.

## Approval Question

Should the implementation plan optimize for keeping the Bee names and fixing
voice recognition first, or should it include a public UI rename pass at the
same time?
