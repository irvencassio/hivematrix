# YouTube Video Factory Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Make the brain note's setup commands work while preserving the existing HiveMatrix video upload stack.

## Tasks

- [x] Add failing tests for news script selection and metadata generation.
  - Files: `video/news-script.test.mjs`
  - Verify first with: `node --test video/news-script.test.mjs`

- [x] Implement `video/news-script.mjs`.
  - File: `video/news-script.mjs`
  - Exports: `AI_TITLE_RE`, `selectAiHeadlines`, `buildDefaultTitle`, `buildDescription`, `buildTemplateScript`, `buildAnthropicPrompt`, `resolveNewsApiKey`.
  - CLI writes `script.txt`, `title.txt`, `description.txt`, `tags.txt`, `headlines.json`.

- [x] Add failing tests for publish runner command construction and upload wrapper mapping.
  - Files: `video/publish-ai-news.test.mjs`, `video/youtube-upload.test.mjs`
  - Verify first with: `node --test video/publish-ai-news.test.mjs video/youtube-upload.test.mjs`

- [x] Implement compatibility wrappers and runner.
  - Files: `video/youtube-auth.mjs`, `video/youtube-upload.mjs`, `video/publish-ai-news.mjs`
  - `youtube-auth.mjs` calls `getAuth([SCOPE_UPLOAD])`.
  - `youtube-upload.mjs` delegates to `publish.mjs`.
  - `publish-ai-news.mjs` runs news script, avatar render, and upload, with `--dry-run`, `--skip-render`, and `--skip-upload`.

- [x] Update documentation.
  - File: `video/README.md`
  - Document canonical OAuth path, compatibility commands, AI-news runner, and dry-run flow.

- [ ] Complete browser-side Google Cloud setup.
  - Enable YouTube Data API v3.
  - Create Desktop OAuth client `HiveMatrix Video Factory`.
  - Save JSON to `~/.hivematrix/youtube/client_secret.json`.
  - Run `node video/youtube-auth.mjs` to cache `~/.hivematrix/youtube/token.json`.

- [ ] Final verification.
  - `node --test video/*.test.mjs`
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
  - `node video/publish-ai-news.mjs --dry-run`
