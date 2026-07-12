# Self-Learning HiveMatrix — Progress Log

Operator morning report. Branch: `self-learning` (from `main`).

## Baseline (before P0)
- `npm run typecheck`: 0 errors ✓
- `node scripts/scope-wall.mjs`: 0 violations ✓
- `npm test`: 2528 pass / 0 fail ✓
- Docs commit: `7438e1b7 docs: self-learning design spec + implementation plan`

Rule: after each phase all three gates must be green with NO NEW failures vs this baseline.

## Task log

| Task | Worker outcome | Review verdict | Commit |
|------|---------------|----------------|--------|
| docs | n/a | n/a | 7438e1b7 |
| P0.1 Swift calendar-helper | swift build+test 3/3 green; EventKit CLI, exit 77 on denial, no Calendar.app launch | ACCEPT — clean pure-encoder split, faithful contract | 2c5dee8f |
| P0.2 PERMISSION_NEEDED convention | pim-preconditions.ts + 4 executors wired; 20/20 | ACCEPT — minimal, no new store | b88c8e2e |
| P0.3 wire calendar to helper | CalendarHelperIO seam; osascript fallback preserved; 29 pass/1 skip | ACCEPT — backward compat clean | 97d73866 |
| P0.4 voice read prover | 3/3 tool-layer prover (voice/turn is LLM-driven → stub at tool layer) | ACCEPT | (P0.4 commit) |

## Phase gate results

| Phase | typecheck | test | scope-wall |
|-------|-----------|------|------------|
| baseline | ✓ 0 | ✓ 2528/0 | ✓ 0 |
| P0 | ✓ 0 | ✓ 2556 pass / 1 skip / 0 fail | ✓ 0 |

## Deviations / notes

- **CONCURRENT WORKSTREAM SHARING THE CHECKOUT (operator: please read).** During P0
  a separate push-notification / companion-app workstream is live-editing the same
  working tree: modified `src/daemon/index.ts`, `src/daemon/server.ts`,
  `src/lib/briefing/morning-briefing.*`, `src/lib/flash/heartbeat.*`,
  `src/lib/voice/loop-closer.*`; new untracked `src/lib/notify/fcm.ts`,
  `src/lib/notify/push.ts`, `docs/companion-ports/`. These are NOT part of self-learning.
  I am strictly scoping every commit to only self-learning files (never `git add -A`).
  COLLISION RISK: P2.4 edits `src/daemon/server.ts` and P2/P3 edit flash-mcp — the
  concurrent stream also touches server.ts. Will land my server.ts edits surgically and
  re-check for conflicts before each such commit.
- P0.1: Package bumped to macOS 14 (`requestFullAccessToEvents` is 14+). `LSMinimumSystemVersion`
  in Info.plist still 12.0 — operator should bump to 14.0 at release, or accept the helper
  requires macOS 14+. Operator machine is macOS 26, so no runtime impact tonight.
- P0.1 Swift: codesign/notarize NOT run (operator's release step). `swift build` + `swift test` green.
- OPERATOR ACTION at first run: EventKit will show a "HiveMatrix wants to access Calendar" TCC
  prompt; must be granted once for calendar_today/create to return real data.
