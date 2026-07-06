# Voice Email Outbox Design

## Context

HiveMatrix is adding a voice-to-email path where the sidecar can turn a dictated email into JSON metadata and the daemon can deliver it through the existing Apple Mail bridge. The current worktree already contains the main pieces: a daemon poller, a sidecar `/email` endpoint, and a standalone prototype script.

## Goal

Commit the voice-email bridge in a buildable state:

- The daemon starts a self-gated outbox watcher.
- The watcher reads `~/.hivematrix/voice-email-outbox/*.json` and calls the existing send/draft Apple Mail functions.
- The sidecar `/email` endpoint writes compatible outbox JSON.
- The test for the watcher proves send, draft, invalid-entry, and start/stop behavior without deleting unrelated real outbox files.

## Approach

Keep the implementation narrow and consistent with existing local-first lane patterns. The outbox directory is the boundary between the Python sidecar and the TypeScript daemon, avoiding a direct cross-runtime call chain.

1. Retain the daemon startup hook in `src/daemon/index.ts`.
2. Harden `src/lib/voice/voice-email-outbox.ts` around JSON field coercion before mail delivery.
3. Fix runtime imports in `voice-sidecar/turn_server.py` for outbox filenames and timestamps.
4. Make `src/lib/voice/voice-email-outbox.test.ts` safe for the operator's real outbox by deleting only test-created files.

## Verification

Run:

- `python3 -m py_compile voice-sidecar/turn_server.py voice-sidecar/voice_email.py`
- `node --import tsx/esm --test src/lib/voice/voice-email-outbox.test.ts`
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npm run build:daemon`
- `HM_SKIP_NOTARIZE=1 bash scripts/build-app.sh`
