# HeyGen Video Agent Creative Mode Design

## Context

The current HiveMatrix avatar path uses `video/make-avatar.mjs`, which calls `video/heygen.mjs` and the older direct avatar render endpoint. That produces predictable talking-head videos, but it does not match the HeyGen portal's more creative output: extra text cards, scene composition, transitions, pacing, and portal-style layout choices.

HeyGen's current public docs position Video Agent (`POST /v3/video-agents`) as the API that most closely matches that portal-like creative experience. It accepts a natural-language prompt, can choose or override avatar and voice, and can apply `style_id` presets that influence scene layout, script structure, text overlays, transitions, and pacing.

## Decision

Use HeyGen Video Agent as the highest-quality, most creative HiveMatrix lane. Keep the direct avatar lane available for deterministic control, but make the daily AI-news publishing flow able to use the Video Agent lane with explicit creative instructions.

## Approaches

1. Use Video Agent as the creative mode.
   - Chosen. It is the closest API match to the native HeyGen portal because HeyGen owns script adaptation, scene composition, and style-driven text cards.

2. Use Template API.
   - Deferred. Templates are best when repeatability and brand structure matter more than creative generation. They can produce text cards, but only when the template already encodes that layout.

3. Recreate text cards locally in Remotion.
   - Deferred. This would be deterministic and cheap after render, but it would imitate the portal rather than using HeyGen's native creative system.

## Design

### API client

Extend `video/heygen.mjs` with Video Agent helpers:

- `buildVideoAgentPrompt(...)` creates a prompt that asks HeyGen for a polished, portal-like video with animated title cards, short text-card breaks, varied scene composition, transitions, and a closing CTA.
- `createVideoAgentSession(...)` calls `POST /v3/video-agents`.
- `listVideoAgentStyles(...)` calls `GET /v3/video-agents/styles`.
- `waitForVideoAgent(...)` polls `GET /v3/video-agents/{session_id}` until a `video_id` exists, then polls `GET /v3/videos/{video_id}` until `completed`, and downloads `video_url`.
- `makeVideoAgentVideo(...)` is the full one-shot helper.

### CLI

Extend `video/heygen.mjs`:

- `--list-agent-styles [--tag cinematic]`
- `--agent-prompt "..."`
- `--script script.txt --agent`
- `--text "..." --agent`
- `--style <style_id>`
- `--orientation landscape|portrait`
- `--creative-brief "..."`

Extend `video/make-avatar.mjs`:

- `--mode direct|agent`
- `--agent` as an alias for `--mode agent`
- `--style <style_id>`
- `--orientation landscape|portrait`
- `--creative-brief "..."`

In agent mode, skip local cloned-voice audio generation. Video Agent works best when HeyGen controls the full creative package, including narration, scene pacing, and text cards. The direct avatar lane remains available for cloned-voice lip sync.

### AI-news pipeline

Extend `video/publish-ai-news.mjs`:

- default render mode becomes `agent` because the user's priority is quality and native-portal-like creative output.
- `--render-mode direct` keeps the old predictable avatar render.
- `--style`, `--orientation`, and `--creative-brief` pass through to `make-avatar.mjs`.
- upload `kind` defaults to `agent-avatar` for the creative lane.

### Daemon bridge

Extend `src/lib/video/factory.ts` and `/video/make` parsing so agents can request:

- `renderMode: "agent"`
- `style`
- `orientation`
- `creativeBrief`

The injected routing prompt should recommend Video Agent mode for polished creative videos and preserve the local narrated factory for exact scripts/how-to screen recordings.

## Verification

- Add tests for pure Video Agent prompt/payload builders and style URL construction.
- Add tests for `publish-ai-news.mjs` command construction with agent mode defaults and direct fallback.
- Add tests for `src/lib/video/factory.ts` argument threading and routing prompt guidance.
- Run:
  - `node --test video/*.test.mjs`
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`

`npx tsx scripts/qwen-readiness.mts` is not required because this does not touch local-model paths.
