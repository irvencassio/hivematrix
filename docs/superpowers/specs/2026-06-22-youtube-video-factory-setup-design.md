# YouTube Video Factory Setup Design

## Context

The brain setup note at `~/_GD/brain/projects/hive/2026-06-22-youtube-video-factory-setup.md` asks for YouTube upload setup plus an AI-news-to-avatar pipeline. The repo is ahead of that note in a few places: `video/package.json` already includes `googleapis`, and the video workspace already has `yt-auth.mjs`, `publish.mjs`, `analytics.mjs`, `yt-ledger.mjs`, and `make-avatar.mjs`.

The missing pieces are:

- A Google Cloud OAuth client JSON saved where the existing code expects it: `~/.hivematrix/youtube/client_secret.json`.
- A command named like the brain note, `node video/youtube-auth.mjs`, so setup can be run explicitly instead of waiting for the first upload.
- A command named `node video/youtube-upload.mjs` that maps the brain note's upload command to the existing `publish.mjs` implementation.
- A news script generator and end-to-end runner for "today's AI news" avatar videos.

## Approaches

1. Replace the existing YouTube uploader with the brain note's sample code.
   - Rejected because it would duplicate working OAuth, ledger, analytics, and scope-upgrade behavior.

2. Keep the existing uploader and add compatibility wrappers plus the missing news pipeline.
   - Chosen because it preserves the tested upload/analytics path while making the brain note's commands work.

3. Build the whole pipeline around a paid news API and Claude SDK dependency.
   - Deferred because no `NEWSAPI_KEY` or Anthropic SDK is currently configured. The first version should be useful with no new key beyond YouTube OAuth and HeyGen.

## Design

### YouTube OAuth setup

Google Cloud will be configured manually in Chrome using the signed-in `cassio.irv@gmail.com` account:

- enable YouTube Data API v3;
- create or verify an OAuth consent screen for HiveMatrix;
- create a Desktop OAuth client named `HiveMatrix Video Factory`;
- download the client JSON and place it at `~/.hivematrix/youtube/client_secret.json`.

The repo code will not store secrets. Token cache remains under `~/.hivematrix/youtube/token.json`.

### Compatibility commands

`video/youtube-auth.mjs` will import `getAuth([SCOPE_UPLOAD])` from `yt-auth.mjs`. It will fail with the existing clear missing-credentials message until `client_secret.json` exists, then open the browser authorization flow and save `token.json`.

`video/youtube-upload.mjs` will delegate to `publish.mjs`, preserving support for `--title`, `--description`, `--tags`, `--privacy`, and adding `--kind avatar` by default unless the caller passes another kind.

### News script generator

`video/news-script.mjs` will be dependency-light and testable:

- default source: Hacker News Firebase top stories, filtered by AI-related title keywords;
- optional source: NewsAPI when `NEWSAPI_KEY` or `~/.hivematrix/config.json newsapi.apiKey` exists;
- writer mode: `auto`, `template`, or `anthropic`;
- `auto` uses Anthropic only when an API key is available, otherwise a deterministic presenter script;
- outputs script, title, description, tags, and headline JSON into `video/out/`.

The deterministic writer is important for setup verification and for machines that only have Claude CLI subscription auth, not an Anthropic API key.

### End-to-end runner

`video/publish-ai-news.mjs` will orchestrate:

1. `news-script.mjs`
2. `make-avatar.mjs`
3. `publish.mjs --kind avatar`

It will support `--dry-run` to stop after writing metadata, `--skip-render` to reuse an existing MP4, and `--skip-upload` to render without publishing.

## Verification

- Add tests for the pure news-script helpers and runner command construction.
- Run `node --test video/*.test.mjs`.
- Run repo gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- For browser setup, verify `~/.hivematrix/youtube/client_secret.json` exists and `node video/youtube-auth.mjs` can create `~/.hivematrix/youtube/token.json`.

