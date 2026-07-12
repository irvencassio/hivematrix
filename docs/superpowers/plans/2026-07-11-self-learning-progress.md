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
| P0.4 voice read prover | 3/3 tool-layer prover (voice/turn is LLM-driven → stub at tool layer) | ACCEPT | 0f487406 |
| P1.1 sandboxed script runner | runSkillSandboxed: sandbox-exec net-deny, env allowlist, timeout, 64KB caps, audit; 10/10 | ACCEPT — synchronous capture (not the detached path), real net-deny verified | 35a3da9f |
| P1.2 failures/probation counters | Skill.failures/probation (min-churn) + recordSkillOutcome promote/demote; 60/60 | ACCEPT — made fields required; manager fixed 2 out-of-scope construction sites (logic-scenarios.ts, skill-turn.test.ts) | 4b090aef |
| P1.3 skill_run lane tool | brain-gated; instruction→recipe, script→sandbox w/ block+trust/probation gate; 35/35 | ACCEPT — correct gate order, honest failures | 16bc9b5a |
| P1.4 skill index in Flash prompt | formatSkillIndex showParams + skill_run guide; verified tool exposure; 17/17 | ACCEPT — backward-compatible opt param | 90fea506 |
| P1.5 skill_run e2e prover | dispatch layer (real sandbox) + stream layer; 3/3 | ACCEPT — real stdout confirmed, no canned value | 86f9352b |
| P2.1 acquisition pipeline skeleton | acquireSkill: mint→parse→scan→evals→critic→register/probation; drafts archive; ledger; 10/10 | ACCEPT — centerpiece, spec-faithful, never registers on failure | 3df0bc41 |
| P2.2 real mint (Sonnet) | defaultMint: tool catalog+skill index+sandbox contract+evals+Reflexion; 2-block parse; 16/16 | ACCEPT — dynamic import avoids cycle | 6ec96131 |
| P2.3 critic (Haiku, fail-closed) | defaultCritic: PASS/FAIL no-tools; ambiguous→fail; both defaults wired; 21/21 | ACCEPT — fail-closed correct | 635963bd |
| P2.4 learn_skill flash tool + async | flash-only tool, 10-min cap, voice:result/flash:notice; SERVER_VERSION bumped; 19/19 | ACCEPT — worker caught+fixed a timer-leak hang | 1bdfe217 |
| P2.5 acquisition integration prover | real fanOutSkills + on-disk ledger; script probation not fanned, instruction SKILL.md written, already-have; 3/3 | ACCEPT — real fanout path confirmed | (P2.5 commit) |

## Phase gate results

| Phase | typecheck | test | scope-wall |
|-------|-----------|------|------------|
| baseline | ✓ 0 | ✓ 2528/0 | ✓ 0 |
| P0 | ✓ 0 | ✓ 2556 pass / 1 skip / 0 fail | ✓ 0 |
| P1 | ✓ 0 | ✓ 2586 pass / 1 skip / 0 fail | ✓ 0 |
| P2 | ✓ 0 | ✓ 2618 pass / 1 skip / 0 fail | ✓ 0 |

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
