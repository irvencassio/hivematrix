# Voice Email Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add a focused design note for the voice-email outbox bridge.
  - Files: `docs/superpowers/specs/2026-07-06-voice-email-outbox-design.md`
  - Verification: design file exists and matches the intended scope.

- [x] Fix sidecar runtime support for `/email` outbox writes.
  - Files: `voice-sidecar/turn_server.py`
  - Change: import `time` and `uuid`, and avoid a redundant local `json` import.
  - Verification: `python3 -m py_compile voice-sidecar/turn_server.py voice-sidecar/voice_email.py`

- [x] Harden daemon outbox JSON processing.
  - Files: `src/lib/voice/voice-email-outbox.ts`
  - Change: coerce `to`, `subject`, `body`, and `sendMode` to strings before trimming.
  - Verification: `node --import tsx/esm --test src/lib/voice/voice-email-outbox.test.ts`

- [x] Make the watcher test safe against real operator outbox contents.
  - Files: `src/lib/voice/voice-email-outbox.test.ts`
  - Change: clean only test-created `email-test-*.json` files.
  - Verification: `npm test`

- [x] Run final gates and package the app.
  - Files: all staged changes.
  - Verification: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, `npm run build:daemon`, and `HM_SKIP_NOTARIZE=1 bash scripts/build-app.sh`.
