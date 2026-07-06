# Voice/Video Simplification — Design

> Status: approved (operator, 2026-07-05). Two coupled removals done as ONE coherent refactor.

## Problem

The voice/video code carries unused and duplicate functionality that confuses worker
models (Claude/Codex/Qwen) operating this repo:

1. **Multiple TTS voices.** TTS supports a cloned VoxCPM2 voice (with recorded voice
   profiles, `high`/`cloned` quality tiers, and voice-profile provisioning) *and* a
   Kokoro voice *and* a macOS `say` fallback — three engines where one is used.
2. **The video factory.** A whole HeyGen-portal video-production feature (~11 `src/lib/video/*`
   modules, daemon routes, console UI, browser-lane seeding, system-readiness checks, and
   workflow definitions) that is no longer wanted.

## Goal

- **(A)** Collapse all TTS to the single **Kokoro** voice. Kokoro is the one real voice.
- **(B)** Remove the **video factory / HeyGen** feature entirely.

Both are operator-approved ("remove video factory too", "get rid of all others including
cloned", "simplify"). Keep the generic **workflows** infrastructure — only the video/heygen
workflow *definitions* go; the two independent content workflows stay.

## Non-goals / constraints

- Do **not** break the generic workflows system the operator uses (registry, runs, actions,
  inbox, prepare). Only remove video/heygen *definitions* and their handler cases.
- Leave the 0.1.142 bitrate fix (`afconvert -b 64000`) intact — unrelated and correct.
- Keep the build green at each stage (`npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`).
- Baseline already has **5 pre-existing failures** unrelated to this work (app-icon insets in
  `scripts/browser-lane-app.test.mjs`, desktop/white-runtime icon tests, and the Mermaid
  same-origin asset test). Gate = no *new* failures beyond these 5.

## Design decisions

### A. Kokoro-only TTS

- **The real voice is the warm Kokoro worker.** `voice-sidecar/turn_server.py` keeps STT +
  Kokoro warm; `src/lib/voice/turn-server.ts` relays turns and `/synth` to it
  (`synthesizeReplyVoice` → `synthesizeLiveVoice` → `relaySynth`). This is untouched — it is
  already Kokoro.
- **`voice-sidecar/tts.py` becomes Kokoro-only.** Remove `_synthesize_cloned`, `_clone_model`
  cache, `_speed_up`, `VOXCPM_MODEL`, `CLONE_TIERS`, `has_voice_profile`, `voice_profile_path`,
  and the internal `say` fallback. `synthesize()` always uses Kokoro. `_synthesize_kokoro`
  raises on some short phrases — handle that (pad/retry) rather than switch to another voice.
  Drop the `quality`/`engine` selection knobs.
- **`src/lib/voice/tts.ts` reduces to the macOS-`say` last resort.** After the video factory is
  gone, the *only* caller of `synthesizeSpeech` is `turn-server.ts`'s explicit
  `engine:"say"` fallback (used when the warm Kokoro worker is down, so a turn is never
  silent). So `synthesizeSpeech` collapses to say-only: remove `TtsEngine`'s `"cloned"`,
  `voiceProfilePath`, `clonedVoiceAvailable`, `synthesizeCloned`, and the cloned branch.
  This is not "a second voice" — it is the emergency last resort; Kokoro remains the voice.
- **Voice-cloning tooling deleted:** `record_voice.py`, `tune_voxcpm.py`, `compare_voices.py`.
- **Python callers** stop passing `quality="high"`/cloned: `synth_cli.py` (drop `--quality`),
  `stream_turn.py`, `live.py`, `talk.py`, `realtime.py` (rename `VoxCPMTTS`→`KokoroTTS`),
  `flash_pipeline.py`, `realtime_server.py`, `prefetch.py` (drop the VoxCPM2 model line).
- **Voice-profile provisioning** (`src/lib/voice/provision.ts`) stays — it provisions the
  engine-agnostic Python runtime (venv + prefetch). Only `prefetch.py`'s VoxCPM2 line goes.
  There are **no** `/voice/provision` routes in `server.ts` today; nothing to remove there.
- `src/lib/config/features.ts`: reword the `voice` flag to drop "cloned voice".

### B. Remove the video factory

- **Delete `src/lib/video/*` entirely** (factory, heygen-workflow, news-intent, news-review,
  portal-completion, publish-draft, review, verify-portal-pipeline, voice-intent, voice-turn,
  draft-store + all their tests).
- **Delete `src/lib/browser-lane/heygen.ts` + test** (HeyGen browser-site seeding).
- **Delete `src/lib/workflows/heygen-run-link.ts` + test** and the video-factory workflow defs
  `heygen-portal.ts`, `video-script.ts`, `video-script-def.ts` + tests.
- **`src/daemon/server.ts`:** remove all `/video/*` routes (`/video/heygen-workflow`,
  `/video/portal-complete`, `/video/publish-draft`, `/video/news/draft`, `/video/drafts`,
  `/video/drafts/:id`, `/video/make`), the AI-news→`video-review` auto-route, and the
  video-draft reply-resolution branch. Remove the now-dead `video-review` executor guards.
- **`src/daemon/console.ts`:** remove the HeyGen portal panel, video-script prep section,
  `video-review` task-detail block, and handlers (`videoReviewAction`, `renderPortalVideos`,
  `publishPortalDraft`, `submitPortalCompletion`, `createPortalTask`, `prepareVideoScript`,
  `saveScriptRevision`) + their refresh hooks. Reword Writer-role copy and the COO
  `app.heygen.com` placeholder. Remove matching tests in `console.test.ts`.
- **`src/lib/system-readiness/index.ts`:** remove the legacy-video-review + HeyGen-seed checks.
- **`src/lib/voice/logic-scenarios.ts`:** remove the video-review voice scenarios and the
  `videoVoiceOverride` import.
- **`src/lib/config/features.ts`:** remove the `video` feature flag (and drop `video` from the
  `HEAVY_FEATURES` set).
- **`server.test.ts`:** remove HeyGen/AI-news video tests.

### Workflows de-integration (operator-confirmed: keep both content workflows)

- `registry.ts` `BUILTIN_WORKFLOWS` = `[CONTENT_RESEARCH_BRIEF_WORKFLOW, YOUTUBE_SUMMARY_WORKFLOW]`
  (drop `HEYGEN_PORTAL_VIDEO_WORKFLOW`, `VIDEO_SCRIPT_WORKFLOW`). Update `registry.test.ts`.
- `prepare.ts`: drop the `content-video-script` and `heygen-portal-video` handler cases; keep
  `content-research-brief` and `content-youtube-summary`.
- `content-research.ts`: strip the video-script proposal (`SCRIPT_TARGET`, the
  `proposeWorkflowAction` block, `proposedAction`) and reword `NEXT_ACTION` + the markdown
  "Suggested next action" to not mention HeyGen/video. `proposedAction` stays in the result
  shape as always-`null` (keeps `prepare.ts`'s result contract stable). Update its tests.
- `youtube-summary*` untouched (already independent).

### iOS (sibling repo `~/hivematrix-ios`, separate git)

Remove the video/HeyGen surface in `Models.swift`, `Services/APIClient.swift`,
`Views/WorkflowsView.swift`, `Views/TaskDetailView.swift`, `Views/NewTaskView.swift`,
`Services/DemoData.swift`. Build green with `xcodebuild build -project HiveMatrix.xcodeproj
-scheme HiveMatrix -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`.
(`QRScanner.swift` matched only on the word "video" for camera capture — leave it.)

### scope-wall

`scripts/scope-wall.mjs` has no video/heygen rule today, so nothing forces removal. After the
feature is gone, add a rule forbidding reintroduction of `lib/video/` / HeyGen video-factory
symbols (allowing `COMPONENT-MAP.md` / `DECISIONS.md` history), and confirm 0 violations.

## Staged plan

1. **Stage 1 — Kokoro-only TTS** (sidecar Python + `voice/tts.ts` + feature copy). Gates green, commit.
2. **Stage 2 — Video factory core** (lib/video, browser-lane/heygen, server routes, console UI,
   features flag, system-readiness, logic-scenarios). Gates green, commit.
3. **Stage 3 — Workflows de-integration** (registry, prepare, content-research). Gates green, commit.
4. **Stage 4 — iOS** surface removal. `xcodebuild` green, commit (separate repo).
5. **Release + deploy** — scope-wall rule, full gates, `./scripts/developer-id-release.sh --release`,
   install DMG, restart daemon, `curl /health`.

## Verification gates (each daemon stage)

- `npm run typecheck` → 0 errors
- `npm test` → no new failures beyond the 5 pre-existing baseline failures
- `node scripts/scope-wall.mjs` → 0 violations
