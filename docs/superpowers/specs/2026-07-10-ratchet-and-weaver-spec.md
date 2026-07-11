# Capability Ratchet + Weaver Audit (2026-07-10)

Two features, two commits, one theme: the system improves itself and holds the
operator accountable. Both ride the EXISTING heartbeat tick mechanism in
`src/lib/flash/heartbeat.ts` (see how the Day Brief ritual was just added:
config fields + last-sent-day idempotence + tick hook — clone that pattern).
No new scheduler, no new persistent store (scope-wall).

## Feature 1: Capability Ratchet (weekly, default OFF: `ratchetEnabled`)
Every voice escalation is a confession of a missing live capability. Weekly,
cluster them and PROPOSE the next tool to build.

- **Log**: voice-origin tasks already carry `output.origin=="voice"` (see
  `src/lib/voice/loop-closer.ts`). The escalation transcript/title IS the
  signal — no new logging needed; query terminal voice-origin tasks from the
  last 7 days.
- **Weekly run** (default Sunday 18:00, config like day-brief fields): one
  `localChatComplete` pass (temp 0, ≤400 tokens) over those task titles +
  descriptions: "cluster these by the capability that was missing; name the
  ONE tool that would have handled the most of them live; describe it in 3
  sentences." Deterministic fallback: top-3 most recent titles listed.
- **Output**: create a HiveMatrix task (same creation lib the flash
  `escalate_to_task` uses) titled "Ratchet: build <tool>" with the analysis
  as description, AND `notify()` a 2-line text ("This week voice couldn't do
  X 4 times — I've queued a proposal to build <tool>."). Skip entirely (no
  task, no text) when there were zero escalations.
- Idempotence: last-sent-week key in heartbeat config state.

## Feature 2: Weaver Accountability Audit (weekly, default OFF: `weaverEnabled`)
The operator's own accountability-auditor persona, armed. Weekly (default
Friday 17:00), diff stated commitments vs observed activity; text the
uncomfortable question.

- **Inputs** (dep-injected, all read-only):
  - Commitments: GOALS.md persona file (same discovery as day-brief.ts) +
    `brain_search` (lib call, not tool) for "plan OR deadline OR by August"
    top 3 docs, first ~2000 chars each.
  - Observed: tasks completed in the last 7 days (titles), git log oneline
    (last 7 days) of the configured project roots if cheaply available via
    existing libs — else tasks alone suffice; do NOT shell out to arbitrary
    repos.
- **One model pass** (`localChatComplete`, temp 0, ≤300 tokens), persona
  framing: "You are Weaver 🌀, the operator's accountability auditor. Given
  commitments and this week's activity, write ≤4 short lines: what moved,
  what's slipping vs a stated deadline, and ONE direct uncomfortable
  question." Deterministic fallback: skip the send (an audit with no insight
  is noise — unlike day-brief, do NOT send a fact-only fallback).
- **Output**: `notify()` text prefixed "🌀 Weaver weekly:". Idempotence:
  last-sent-week key.

## Shared requirements
- Config: extend `HeartbeatConfig` + the `/settings/heartbeat` GET/POST route
  + `POST /heartbeat/run` manual moments (`"ratchet"`, `"weaver"`) exactly as
  day-brief did. Both default OFF.
- Pure/unit-testable: cluster-prompt builder, week-key + due functions,
  zero-escalation skip, weaver skip-on-model-failure, task-creation payload.
  node:test style; extend heartbeat.test.ts default-config assertion.
- Gate: `npm test` + `npm run typecheck` + `npm run scope-wall` all green.
- Two commits on main, push. Trailer:
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
