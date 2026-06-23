# HeyGen Video Agent Creative Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Make the video factory's best-quality creative path use HeyGen Video Agent so generated videos are closer to the native HeyGen portal experience, while preserving the direct avatar lane for deterministic control.

## Tasks

- [x] Add failing Video Agent client tests.
  - Files: `video/heygen.test.mjs`
  - Cover `buildVideoAgentPrompt`, `buildVideoAgentPayload`, `buildVideoAgentStylesPath`, and status extraction helpers.
  - Verify first with: `node --test video/heygen.test.mjs`

- [x] Implement Video Agent client helpers and CLI flags.
  - File: `video/heygen.mjs`
  - Add exported helpers for prompt/payload/path construction.
  - Add `listVideoAgentStyles`, `createVideoAgentSession`, `waitForVideoAgent`, and `makeVideoAgentVideo`.
  - Add CLI flags: `--agent`, `--agent-prompt`, `--style`, `--orientation`, `--creative-brief`, `--list-agent-styles`, `--tag`.

- [x] Add failing pipeline command tests.
  - Files: `video/publish-ai-news.test.mjs`
  - Assert default render command uses `make-avatar.mjs --mode agent`.
  - Assert `--render-mode direct` can preserve the old direct command.
  - Verify first with: `node --test video/publish-ai-news.test.mjs`

- [x] Wire AI-news and avatar CLI to Video Agent mode.
  - Files: `video/make-avatar.mjs`, `video/publish-ai-news.mjs`
  - In agent mode, call `makeVideoAgentVideo` and skip local cloned-voice audio.
  - Pass `--style`, `--orientation`, and `--creative-brief`.

- [x] Add failing daemon bridge tests.
  - Files: `src/lib/video/factory.test.ts`
  - Assert `buildMakeArgs` threads `--mode agent`, `--style`, `--orientation`, and `--creative-brief`.
  - Assert routing prompt mentions creative Video Agent mode.

- [x] Wire daemon bridge and routing prompt.
  - Files: `src/lib/video/factory.ts`, `src/daemon/server.ts`, `src/lib/orchestrator/outbound-routing.ts`
  - Add `renderMode`, `style`, `orientation`, and `creativeBrief` handling.

- [x] Update documentation.
  - File: `video/README.md`
  - Document creative Video Agent mode, style discovery, direct fallback, and example commands.

- [x] Final verification.
  - `node --test video/*.test.mjs`
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
