# Self-Learning HiveMatrix — Design Spec

Date: 2026-07-11
Author: Fable (planning tier) — for Opus (manager) + Sonnet (workers)
Status: Approved for implementation tonight (operator directive: ship or shut down)

## The problem, concretely

Two failures tonight define the gap:

1. **"Tell me my events for today"** (voice) → Calendar.app opened, no answer.
   Root cause: `calendar_today` (`src/lib/orchestrator/pim-tools.ts:134,224-250`) reads
   events via `osascript 'tell application "Calendar"'`. Sending Apple events *launches*
   Calendar.app, then the read is refused because nothing in the daemon chain has the
   Automation (Apple Events) TCC grant or entitlement (verified: no
   `com.apple.security.automation.apple-events` in `src-tauri/entitlements/daemon.entitlements.plist`,
   no EventKit anywhere in the repo). The tool opens the app and returns
   "Could not read the calendar".

2. **"Go update HiveMatrix to have this capability"** (voice) → nothing useful.
   The voice turn is regex-first (`src/lib/voice/command-intent.ts`); unmatched text falls
   through to the Flash lane (`claude --model haiku` + strict MCP toolset,
   `src/lib/flash/loop.ts:141-169`). Flash has no doctrine and no tool for "I can't do
   this — acquire the capability or improve HiveMatrix." Its `escalate_to_task` defaults
   `projectPath` to `homedir()` (`src/lib/flash/flash-mcp.ts:208`), so even a correct
   escalation doesn't land in the HiveMatrix repo.

The deeper architectural fact (from tonight's full recon): HiveMatrix **already has** a
skill library (`src/lib/skills/` — agentskills.io format, instruction+script kinds,
Ed25519 signing, scan-on-install, trust flags, use counts, prune), a learning loop that
distills cold sessions into skills (`src/lib/flash/distill.ts`), fan-out of trusted
skills into `~/.claude/skills/` (`src/lib/skills/fanout.ts`) where the `claude` CLI
auto-discovers them **live, mid-session**, and a capability-gap detector
(`src/lib/feedback/capability-gaps.ts`) that classifies missing capabilities and files
proposals — but by design *never acquires anything*.

So the framework is 70% built. What's missing is the **closed loop**:

- Flash cannot *execute* script skills (it runs with `--tools ""`; skills only fan out
  to the task lane's harness dirs).
- Nothing *synthesizes* a skill on demand when a live request hits a capability miss.
- Nothing *verifies* a synthesized skill end-to-end before trusting it.
- The gap detector files proposals into a backlog no one drains autonomously.
- Voice has no path from "improve yourself" to the coding harness on this repo.

## Research grounding (2025–2026, full report in session notes)

- **Voyager** (MineDojo): acquire → sandbox-run → LLM-critic verify → store, indexed by
  natural-language description; retrieved top-k into future prompts. Our skill library's
  `description` field + the claude CLI's skill discovery already implement retrieval.
- **LATM / SkillWeaver**: the expensive model mints a tool once (with tests); the cheap
  model spends it forever. Maps exactly to Sonnet-mints / Haiku-uses.
- **skill-creator** (Anthropic): evals.json + assertion grading as the verification gate;
  Anthropic's stated roadmap is agents that author their own skills.
- **ACE** (Stanford 2510.04618): evolve context by itemized deltas with
  helpful/harmful counters; never wholesale-rewrite. **DGM** (Sakana): archive superseded
  variants, never delete. **TroVE**: prune by use-count (we have `prune.ts`, `useCount`).
- **Claude CLI facts that make this cheap**: skills added under `~/.claude/skills/`
  take effect within a running session (live change detection); headless `claude -p`
  loads skills exactly like interactive; `--add-dir` also mounts that dir's skills.

## The ClawHavoc line (unchanged, load-bearing)

`capability-gaps.ts` doctrine stands: **skills are the only self-serviceable remedy.**
Lanes (credentials) and packs (signed installs) stay operator-gated forever. Everything
in this spec acquires capabilities exclusively as *first-party skills* that pass the
existing scan gate (`skills/scan.ts`) plus a new verification ladder. A synthesized
skill that fails scan or verification is archived as a draft, never registered as
trusted, never fanned out.

Script-skill execution gets a hard sandbox at the daemon dispatch point (P1): no
network by default, brain-root+tmp write scope, timeout, and an audit event per run —
this closes recon gap #2 (script skills previously piggybacked on the harness Bash tool
with no gating of their own).

## Design: five pillars

### P0 — Calendar reads work (flagship + template for OS-permission preconditions)

**Goal:** voice "what are my events today?" → spoken list of actual events.

- Replace the AppleScript event read with a **Swift EventKit helper**: a tiny CLI
  (`calendar-helper`) in `desktopbee-helper` (SwiftPM package already exists, already
  ships in the bundle, already holds the apple-events entitlement) that uses
  `EKEventStore` to list events (JSON out) and create events. EventKit does NOT launch
  Calendar.app and has its own clean TCC prompt ("HiveMatrix wants access to your
  calendar") attributed to the helper. Add `NSCalendarsFullAccessUsageDescription` to the
  helper's Info.plist; request full access on first use.
- `executeCalendarToday` / `executeCalendarCreate` (`pim-tools.ts`) call the helper
  binary; keep osascript as documented fallback when the helper is missing (dev runs).
- **Permission-precondition model (small, generalizable):** each PIM tool declares its
  OS precondition; on failure the tool returns a structured
  `PERMISSION_NEEDED: <grant> — <one spoken sentence of remediation>` result so Flash
  *speaks the fix* instead of dead-ending ("I need calendar access — I've just triggered
  the permission prompt / open Privacy & Security → Calendars"). No new store; it's a
  result convention + one helper.
- Same treatment (result convention only, not new helpers) for `contacts_lookup`,
  `reminders_list`, `reminder_create` — they keep osascript tonight but must return the
  structured permission error instead of a generic failure.

**Acceptance (prover):** with calendar permission granted, `POST /voice/turn`
`{text:"what are my events today"}` returns a spoken reply containing today's real event
titles, and Calendar.app is NOT launched. With permission missing, the reply contains
the remediation sentence. Unit tests mock the helper; one gated integration test runs
the real helper when `HIVE_TEST_EVENTKIT=1`.

### P1 — Flash can run skills: `skill_run` lane tool

**Goal:** the skill library becomes *arms* for the chat/voice agent, not just task-lane
recipes.

- New lane tool `skill_run` in `LANE_TOOL_DEFINITIONS` (`lane-tools.ts`), capability-gated
  under `brain`: input `{name, params?}`.
  - `instruction` skill → returns the skill body (params applied via
    `applySkillParams`) for the model to follow in-turn.
  - `script` skill → executes via `skills/run-script.ts` **only if `trusted` and
    scanVerdict ≠ block**, inside the new sandbox runner: `timeout` (default 30s,
    frontmatter-overridable ≤120s), cwd = a per-run scratch dir, env-scrubbed
    (no daemon token), stdout capped, audit event `skill:run` with outcome.
    Untrusted script → structured refusal naming the probation path.
- Existing `skill_used` remains the usage-ledger call; `skill_run` records it
  automatically (increment `useCount`, and on failure record a `harmful` counter —
  new frontmatter field `failures: <n>`, ACE-style two counters).
- Inject the skill index into the **Flash** system prompt (it's already formatted by
  `formatSkillIndex`, contracts.ts:243) — today only tasks get it; Flash must too
  (`flash/context.ts`), including each skill's params so Haiku can call `skill_run`
  correctly.

**Acceptance:** a seeded trusted script skill (e.g. `system-uptime`) is callable
end-to-end: voice "use the system uptime skill" → `skill_run` → real output spoken.
Untrusted script skill → spoken refusal that names the approval path. Sandbox tests:
network blocked, token absent from env, timeout kills.

### P2 — Live capability acquisition: `learn_skill` (the centerpiece)

**Goal:** a capability miss during a live turn becomes a *learned, verified, reusable
skill* — usually within the same conversation.

- New flash-only tool `learn_skill` (`flash-mcp.ts` pattern, dispatched in the daemon):
  input `{goal, why_needed, suggested_kind?}`. Because acquisition takes minutes, it
  follows the existing **async speak-back pattern** (deep_think/heartbeat,
  `command-turn.ts:668-729`): Flash acks by voice ("I don't know how to do that yet.
  Give me a few minutes to learn it — I'll speak up when I've got it"), and the result
  is broadcast as `voice:result` when done.
- The daemon-side pipeline (`src/lib/skills/acquire.ts`, new — the only substantial new
  module tonight):
  1. **Mint** (Sonnet, task lane `subprocess.ts` invocation, model tier "code"): prompt
     carries the goal, the full current tool catalog + skill index (so it composes
     instead of duplicating — Voyager retrieval), the SKILL.md/script-skill format
     contract, and the sandbox constraints. Output: a draft skill file + 2–4 eval cases
     (`evals.json`: input params → assertion on stdout, skill-creator style).
  2. **Verification ladder** (each rung short-circuits to `draft-failed`):
     a. `parseSkillFile` schema validity + params sanity;
     b. `skills/scan.ts` — `block` verdict is fatal (existing injection/exfil rules);
     c. sandboxed smoke-run of each eval case (same runner as P1);
     d. **independent critic** (one `claude --model haiku -p` call, no tools): shown
        goal + skill + eval transcripts, answers PASS/FAIL with reason — the
        Voyager-style judge that is not the generator.
  3. **Register on pass:** `upsertSkill` with `source: acquired`, `trusted: true`
     *only for* `instruction` kind; `script` kind starts **probation** — `trusted: false`
     + new frontmatter `probation: true`, auto-promoted to trusted after 3 successful
     `skill_run`s with zero failures (TroVE/ladder promotion), OR immediately if the
     operator approves the surfaced notice. Fan-out (`fanout.ts`) runs on registration
     for trusted skills, so the *running* claude session can already see it.
     Probationary scripts ARE runnable via `skill_run` (that's how they earn promotion)
     but each run is announced in the reply ("using a skill I learned recently").
  4. **Failure:** archive the draft under `<brainRoot>/skills/drafts/` (DGM: archive,
     never delete) and file the existing capability-gap proposal with the failure
     reason. Speak the honest outcome.
  5. Every stage emits an audit event (`skill:acquire:*`) and a one-line ledger entry
     appended to `<brainRoot>/skills/ACQUISITIONS.md` (date, goal, outcome, cost) —
     operator-legible history, no new store.
- **Budget rails:** one acquisition per turn; hard wall-clock cap (10 min); per-day cap
  (default 10, config `skills.acquireDailyCap`) so a bad night can't burn the window.
- **Retry-with-memory (Reflexion):** the mint prompt includes the archived draft +
  failure reason when re-attempting a previously failed goal.

**Acceptance:** with the calendar tools *disabled* in a test fixture, voice
"how many files are in my Downloads folder?" (no existing tool) → ack → acquisition →
`voice:result` speaks the correct count → `<brainRoot>/skills/` contains the new skill
with `source: acquired` → second identical request uses the learned skill directly with
no acquisition. Full pipeline unit-tested with a stubbed mint (fake claude binary,
pattern exists in `loop.test.ts`).

### P3 — Voice doctrine: never dead-end, and "improve yourself" routes to the repo

- **Capability doctrine** appended to the Flash system prompt (`flash/context.ts`), the
  escalation ladder in one paragraph: answer directly → use a tool → `skill_run` a
  library skill → `learn_skill` a missing one → `escalate_to_task` for multi-step work →
  if it's about HiveMatrix's own code, escalate with `projectPath` = the HiveMatrix
  repo. Explicit instruction: *never* reply "I can't do that" without either learning or
  escalating, and never claim success that a tool result doesn't show (honest-failure
  rule already in persona).
- `escalate_to_task` (`flash-mcp.ts:201-238`): add optional `kind: "self-improvement"`;
  when set (or when the description names HiveMatrix), default `projectPath` to the
  configured HiveMatrix repo path (new config key `selfImprove.repoPath`, default this
  repo; surfaced in settings) and prefix the task description with the Superpowers
  pipeline requirement (AGENTS.md already enforces it in-repo).
- Self-improvement tasks are **normal tasks** — they flow through the existing approval
  queue and directive machinery; nothing about task execution changes. (The coding
  harness modifying the running app is already the operator's shipped workflow —
  release/update machinery handles the rest.)

**Acceptance:** voice "update HiveMatrix so it can read my calendar" → task created with
`projectPath` = repo, `workflow: "work"`, voice-origin marker set (loop-closer texts the
outcome back — existing machinery). Regex suite in `logic-scenarios.ts` extended so
utterances like "update/improve/teach yourself to X" are NOT swallowed by
`createTask`'s generic regex before Flash sees them.

### P4 — Close the background loop (autonomy-gated)

- `capability-gaps.ts`: for clusters with `remedy === "skill"`, instead of only filing a
  proposal, call the P2 acquisition pipeline directly when autonomy mode permits
  (`autonomous` → acquire, else file the proposal with a one-tap "learn it" action that
  triggers the same pipeline). Lane/pack remedies unchanged (gated forever).
- `prune.ts`: change delete → **archive to `skills/archive/`** with a dated suffix
  (DGM), and demote (untrust) rather than remove skills whose `failures` outweigh
  `useCount` (ACE counters from P1).
- Nightly learning-loop pass already runs pattern detection; wire the new acquisition
  counter into the morning briefing ("I learned 2 new skills yesterday: …" —
  `voice/briefing.ts`), so learning is *visible*.

**Acceptance:** a seeded feedback backlog with 2 skill-remedy gaps + autonomy=autonomous
→ next learning-loop pass attempts acquisition and the briefing mentions the outcome.

## What we are NOT building tonight (scope wall)

- No new persistent store, no vector DB (description-based retrieval via skill index +
  CLI discovery is enough at this library size; embeddings dir exists if ever needed).
- No runtime *native tool* registration (recon gap #1) — skills ARE the runtime
  capability unit; native tools stay compiled and reviewed.
- No self-modification outside the task pipeline (no DGM-style agent-code rewriting;
  self-improvement = normal reviewed tasks on this repo).
- No autonomous lane/pack acquisition, ever.
- No Mem0/Letta import — persona/brain memory is out of scope tonight.

## Execution & verification

Per AGENTS.md: TDD (failing test first), subagent-driven development, and the gates —
`npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` — plus the acceptance
provers listed per pillar. Order: P0 → P1 → P2 → P3 → P4 (P1 before P2: acquisition is
useless if Flash can't run what it learns). P0 and P3 are independent of P1/P2 and can
run in parallel worktrees.

Model assignment per the operator's directive: Fable planned (this doc); **Opus
manages** (dispatch, review, integration, gate enforcement); **Sonnet executes** each
task. COMPONENT-MAP.md and DECISIONS.md must be updated by the final integration task
(complexity-budget accounting: new concepts = 0; new modules = `skills/acquire.ts`,
`skills/sandbox.ts`, `calendar-helper`; everything else is edits to existing seams).
