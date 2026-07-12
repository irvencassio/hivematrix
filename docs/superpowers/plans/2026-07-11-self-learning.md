# Self-Learning HiveMatrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-07-11-self-learning-design.md` (read it first — it
carries the why, the ClawHavoc line, and the acceptance provers).

Ground rules: TDD (failing test first, watch it fail), one task per subagent, gates
after each phase: `npm run typecheck && npm test && node scripts/scope-wall.mjs`.
Model routing: workers = Sonnet; manager = Opus. Phases P0 and P3 may run in parallel
with P1/P2 (disjoint files). P4 last.

---

## Phase P0 — Calendar via EventKit + permission preconditions

- [ ] **P0.1 Swift `calendar-helper` subcommand in desktopbee-helper.**
  Files: `desktopbee-helper/Sources/...` (follow existing package layout; add a
  `calendar` subcommand: `calendar today` → JSON `[{title,start,end,calendar,allDay}]`,
  `calendar create --title --start --end [--calendar]` → JSON `{ok,id}`),
  Info.plist/entitlements: add `NSCalendarsFullAccessUsageDescription`; request
  full access via `EKEventStore.requestFullAccessToEvents`. Exit code 77 +
  `{"error":"permission"}` on denial. Must NOT launch Calendar.app.
  Test: SwiftPM unit test for JSON encoding; manual smoke documented in the task.
- [ ] **P0.2 Structured permission-error convention.**
  Files: `src/lib/orchestrator/pim-tools.ts` (+ new `pim-preconditions.ts` if cleaner),
  tests first in `pim-tools.test.ts`: a tool failure caused by missing OS permission
  returns `PERMISSION_NEEDED: <grant> — <spoken remediation sentence>` (exact prefix,
  parseable). Apply to calendar/contacts/reminders executors.
- [ ] **P0.3 Wire `calendar_today`/`calendar_create` to the helper.**
  Files: `src/lib/orchestrator/pim-tools.ts`. Resolve helper binary (same discovery the
  desktopbee lane uses — see `src/lib/desktopbee/`); parse JSON; osascript fallback
  only when helper binary absent; permission exit → P0.2 convention. Tests: mock
  helper via injectable exec (pattern exists in `pim-tools.test.ts`); gated real-run
  test under `HIVE_TEST_EVENTKIT=1`.
- [ ] **P0.4 Prover.** New test in `src/lib/voice/`: `/voice/turn` text
  "what are my events today" with stubbed helper events → reply contains event titles;
  with permission-error stub → reply contains remediation sentence.

## Phase P1 — `skill_run` + sandbox + counters

- [ ] **P1.1 Sandboxed script runner.**
  New `src/lib/skills/sandbox.ts` (+ `sandbox.test.ts` FIRST): wraps
  `skills/run-script.ts` execution with: per-run scratch cwd, env allowlist (no
  `HIVE_*` token vars, no `HOME` secrets beyond what's needed), timeout (default 30s,
  frontmatter `timeout:` cap 120s), stdout/stderr cap (64KB), and `sandbox-exec`
  network-deny profile on darwin (graceful no-sandbox fallback with audit flag when
  unavailable). Emits `skill:run` audit event (see `src/lib/audit/`).
- [ ] **P1.2 `failures` counter + probation fields.**
  Files: `src/lib/skills/contracts.ts` (+ test): frontmatter `failures: <n>`,
  `probation: true|false`; `renderSkillFile`/`parseSkillFile` round-trip; new
  `recordSkillOutcome(name, ok)` in `skills/store.ts` (increments useCount or failures;
  promotes probation→trusted at 3 consecutive successes, demotes trusted→untrusted when
  failures ≥ max(3, useCount)).
- [ ] **P1.3 `skill_run` lane tool.**
  Files: `src/lib/orchestrator/lane-tools.ts` (+ test first in `lane-tools.test.ts`):
  definition (gate cap `brain`), dispatch in `executeLaneTool`: instruction → body with
  `applySkillParams`; script → trusted/probation check + scanVerdict≠block + sandbox run
  + `recordSkillOutcome`; untrusted → structured refusal naming approval path.
- [ ] **P1.4 Skill index into Flash prompt.**
  Files: `src/lib/flash/context.ts` (+ test): inject `formatSkillIndex` (with params
  listed per skill) + one-paragraph "how to use skill_run". Confirm `skill_run` reaches
  Flash's allowed tools (`flash/loop.ts` READ_ONLY vs full sets — full only).
- [ ] **P1.5 Prover.** Seed a trusted script skill in a temp brain root; end-to-end
  flash-loop test with fake claude binary emitting a `skill_run` tool call → sandbox
  executes → result in tool_result stream.

## Phase P2 — `learn_skill` acquisition pipeline

- [ ] **P2.1 Acquisition pipeline skeleton.**
  New `src/lib/skills/acquire.ts` (+ `acquire.test.ts` FIRST): `acquireSkill({goal,
  whyNeeded, suggestedKind, attempt})` → mint (injectable `mint` fn) → ladder: parse →
  scan → sandboxed evals → critic (injectable) → register/probation per spec → on fail
  archive to `<brainRoot>/skills/drafts/` + capability-gap proposal + return honest
  failure. Ledger line to `<brainRoot>/skills/ACQUISITIONS.md`. Audit events
  `skill:acquire:{start,minted,verified,registered,failed}`. Daily cap via config
  `skills.acquireDailyCap` (default 10).
- [ ] **P2.2 Real mint via task-lane claude.**
  Files: `acquire.ts` default mint impl using `subprocess.ts` claude spawn (model tier
  "code" → Sonnet), prompt = goal + tool catalog (`availableLaneTools` names+desc) +
  skill index + script-skill format contract + sandbox constraints + evals.json format
  + (on retry) archived draft & failure reason. Output parsing: skill file + evals.
  Test with fake claude binary (pattern: `flash/loop.test.ts`).
- [ ] **P2.3 Critic.**
  Files: `acquire.ts`: one `claude --model haiku -p` no-tools call, PASS/FAIL + reason;
  injectable; test both verdicts.
- [ ] **P2.4 `learn_skill` flash-only tool + async speak-back.**
  Files: `src/lib/flash/flash-mcp.ts` (defs + dispatch), `src/daemon/server.ts`
  (`/flash/tool/learn_skill` route already generic — verify), async pattern copied from
  deep_think delivery (`voice/command-turn.ts:699-729` equivalent for flash channel):
  immediate ack string returned to the model; pipeline runs detached; outcome broadcast
  `voice:result` (voice channel) / `flash:notice` (chat). Tests first.
- [ ] **P2.5 Prover.** Integration test: fake mint producing a working script skill →
  full ladder passes → skill registered with `source: acquired`, probation for script →
  fanout dir contains SKILL.md for instruction-kind case → second `acquireSkill` for
  same goal short-circuits ("already have skill X").

## Phase P3 — Voice doctrine + self-improvement routing

- [ ] **P3.1 Capability doctrine in Flash system prompt.**
  Files: `src/lib/flash/context.ts` (+ test asserting the ladder paragraph present):
  answer → tool → skill_run → learn_skill → escalate_to_task; never dead-end; honest
  failures; self-improvement goes to the HiveMatrix repo.
- [ ] **P3.2 `escalate_to_task` self-improvement kind.**
  Files: `src/lib/flash/flash-mcp.ts` (+ test): optional `kind:"self-improvement"` →
  `projectPath` = config `selfImprove.repoPath` (default: this repo's path from config;
  add key + settings surface in `src/lib/central/config.ts` pattern), description
  prefixed with Superpowers requirement. Voice-origin marker preserved.
- [ ] **P3.3 Regex de-confliction.**
  Files: `src/lib/voice/command-intent.ts` (+ `logic-scenarios.ts` cases FIRST):
  utterances matching /\b(update|improve|teach|upgrade)\b.*(yourself|hivematrix|hive matrix)/i
  must NOT be captured by `createTask`/other generic intents — return `none` so Flash
  handles them agentically.
- [ ] **P3.4 Prover.** Voice-turn test: "update hivematrix so it can read my calendar"
  (fake claude emitting escalate_to_task with kind self-improvement) → task row has
  repo projectPath + workflow "work" + voice-origin output marker.

## Phase P4 — Background loop + archive-not-delete + visibility

- [ ] **P4.1 Gap → acquisition (autonomy-gated).**
  Files: `src/lib/feedback/capability-gaps.ts` (+ test): remedy==="skill" clusters →
  when autonomy mode is `autonomous` (see existing autonomy policy used by
  persona-evolution) call `acquireSkill`; else file proposal (unchanged) with
  metadata flagging one-tap learnability. Lane/pack paths untouched.
- [ ] **P4.2 Prune → archive + demote.**
  Files: `src/lib/skills/prune.ts` (+ test): deletions become moves to
  `skills/archive/<name>.<date>.md`; add demotion pass using P1.2 counters.
- [ ] **P4.3 Briefing line.**
  Files: `src/lib/voice/briefing.ts` (+ test): "I learned N new skills yesterday: …"
  from ACQUISITIONS.md ledger (last 24h), omitted when zero.

## Final integration task

- [ ] **F.1** Update `COMPONENT-MAP.md` (skill_run, learn_skill, calendar-helper,
  sandbox) + `DECISIONS.md` (new Q: live skill acquisition & the verification ladder;
  complexity accounting) + `CHANGELOG.md`. Run all gates + full test suite. Confirm
  P0/P2/P3 provers green. Do NOT release; the operator releases via
  `scripts/developer-id-release.sh` after review.
