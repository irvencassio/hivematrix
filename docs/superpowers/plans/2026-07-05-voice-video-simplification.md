# Voice/Video Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-05-voice-video-simplification-design.md`.
Baseline: 2732 pass / 5 pre-existing failures (icon + Mermaid asset tests). Gate = no new failures.

---

## Stage 1 — Kokoro-only TTS

- [ ] Delete voice-cloning tooling: `voice-sidecar/record_voice.py`, `voice-sidecar/tune_voxcpm.py`, `voice-sidecar/compare_voices.py`.
- [ ] `voice-sidecar/tts.py` → Kokoro-only: remove `VOXCPM_MODEL`, `CLONE_TIERS`, `_clone_model`, `_synthesize_cloned`, `_speed_up`, `has_voice_profile`, `voice_profile_path`, `_synthesize_say`, and the `quality`/`engine` selection + internal say fallback. `synthesize()` always routes to Kokoro. Handle `_synthesize_kokoro`'s short-phrase raise gracefully (pad/retry, do not switch voice). `warmup()` warms Kokoro only.
- [ ] `voice-sidecar/prefetch.py`: delete the `mlx-community/VoxCPM2-bf16` line.
- [ ] `voice-sidecar/synth_cli.py`: drop `--quality`; always Kokoro.
- [ ] `voice-sidecar/stream_turn.py`, `live.py`, `talk.py`, `realtime.py` (rename `VoxCPMTTS`→`KokoroTTS`, fix docstring), `flash_pipeline.py`, `realtime_server.py`: stop passing/plumbing `quality="high"` / `HIVE_RT_TTS_QUALITY`; hardcode Kokoro.
- [ ] Update `voice-sidecar` python tests that assert cloned/quality behavior (run `voice-sidecar` tests if any gate on them; otherwise smoke `python -c` import).
- [ ] `src/lib/voice/tts.ts` → say-only last resort: `TtsEngine = "say"`; remove `voiceProfilePath`, `clonedVoiceAvailable`, `synthesizeCloned`, cloned branch in `synthesizeSpeech`, and cloned wording in the header comment.
- [ ] `src/lib/config/features.ts`: reword the `voice` flag description to drop "in your cloned voice".
- [ ] Update `src/lib/voice/tts.test.ts` (and any test referencing cloned/`voiceProfilePath`).
- [ ] Gate: `npm run typecheck` (0), `npm test` (≤5 known fails), `node scripts/scope-wall.mjs` (0). Commit + push.

## Stage 2 — Video factory core

- [ ] Delete `src/lib/video/` entirely (all .ts + .test.ts).
- [ ] Delete `src/lib/browser-lane/heygen.ts` + `heygen.test.ts`.
- [ ] Delete `src/lib/workflows/heygen-run-link.ts` + `.test.ts`, `heygen-portal.ts`, `video-script.ts`, `video-script-def.ts`, `video-script.test.ts`.
- [ ] `src/daemon/server.ts`: remove `/video/heygen-workflow`, `/video/portal-complete`, `/video/publish-draft`, `/video/news/draft`, `/video/drafts`, `/video/drafts/:id`, `/video/make`; the AI-news→`video-review` auto-route; the video-draft reply-resolution branch; dead `video-review` executor guards; and now-unused imports.
- [ ] `src/daemon/console.ts`: remove HeyGen portal panel, video-script prep section, `video-review` task-detail block, handlers (`videoReviewAction`, `renderPortalVideos`, `publishPortalDraft`, `submitPortalCompletion`, `createPortalTask`, `prepareVideoScript`, `saveScriptRevision`), refresh-chain call to `renderPortalVideos()`; reword Writer-role copy + `app.heygen.com` placeholder.
- [ ] `src/daemon/console.test.ts`: remove video-review + AI-news video shortcut tests.
- [ ] `src/lib/system-readiness/index.ts`: remove legacy-video-review + HeyGen-seed checks and their imports.
- [ ] `src/lib/voice/logic-scenarios.ts`: remove video-review scenarios + `videoVoiceOverride` import; fix any `ScenarioKind` union.
- [ ] `src/lib/config/features.ts`: remove the `video` KNOWN_FEATURES row and drop `"video"` from `HEAVY_FEATURES`.
- [ ] `src/daemon/server.test.ts`: remove HeyGen/AI-news video tests.
- [ ] Grep sweep: `grep -rn "lib/video\|browser-lane/heygen\|video-review\|heygen-run-link\|videoDraft\|runVideoFactory" src/` → only intended remnants (none in prod code).
- [ ] Gate: typecheck/test/scope-wall. Commit + push.

## Stage 3 — Workflows de-integration

- [ ] `src/lib/workflows/registry.ts`: drop `HEYGEN_PORTAL_VIDEO_WORKFLOW` + `VIDEO_SCRIPT_WORKFLOW` imports; `BUILTIN_WORKFLOWS = [CONTENT_RESEARCH_BRIEF_WORKFLOW, YOUTUBE_SUMMARY_WORKFLOW]`.
- [ ] `src/lib/workflows/prepare.ts`: delete the `content-video-script` and `heygen-portal-video` handler cases (keep `content-research-brief`, `content-youtube-summary`).
- [ ] `src/lib/workflows/content-research.ts`: remove `SCRIPT_TARGET`, the `proposeWorkflowAction` proposal block + `proposeWorkflowAction`/`getWorkflowRegistry`(if now unused) import; set `proposedAction` always `null`; reword `NEXT_ACTION` (line ~98) and the markdown "Suggested next action" (line ~75) to not mention HeyGen/video.
- [ ] Update `registry.test.ts`, `prepare.test.ts`, `content-research.test.ts`, `inbox.test.ts`, `actions.test.ts` for the removed defs (replace HeyGen-target assumptions with a surviving/dummy workflow; drop video-script assertions).
- [ ] Gate: typecheck/test/scope-wall. Commit + push.

## Stage 4 — iOS (`~/hivematrix-ios`, separate git)

- [ ] Remove video/HeyGen surface in `Models.swift`, `Services/APIClient.swift`, `Views/WorkflowsView.swift`, `Views/TaskDetailView.swift`, `Views/NewTaskView.swift`, `Services/DemoData.swift`. (Leave `QRScanner.swift` — "video" there is camera capture.)
- [ ] Regenerate project if needed (`xcodegen`), then `xcodebuild build -project HiveMatrix.xcodeproj -scheme HiveMatrix -destination 'platform=iOS Simulator,name=iPhone 17 Pro'` → success.
- [ ] Commit + push (iOS repo).

## Stage 5 — scope-wall + release + deploy

- [ ] Add a `scripts/scope-wall.mjs` rule forbidding reintroduction of `lib/video/` / HeyGen video-factory (allow `COMPONENT-MAP.md`, `DECISIONS.md`). `node scripts/scope-wall.mjs` → 0.
- [ ] Update `COMPONENT-MAP.md` / `DECISIONS.md` if they document the video factory (note removal).
- [ ] Full gates green.
- [ ] `./scripts/developer-id-release.sh --release` (bumps version, notarizes, publishes feed, pushes main).
- [ ] Install built DMG; restart `com.hivematrix.daemon` LaunchAgent (bootout → swap → bootstrap); `curl -s http://127.0.0.1:3747/health`.
