# The System Shows Up — day brief, rituals, contextual greeting (2026-07-10)

One primitive, three surfaces. Theme: stop waiting to be asked.

## Primitive: `composeDayBrief(kind: "morning" | "evening")`
New module `src/lib/flash/day-brief.ts`. Assembles the operator's day from
what shipped today: PIM reads (`calendar_today`, `reminders_list` via
`executePimTool`), `workflow_inbox`-style task state (discover the lib the
tool uses), and recent voice-origin loop-closures (tasks whose
`output.origin === "voice"` with `output.loopNotifiedAt` in the last 12h —
see `src/lib/voice/loop-closer.ts`).

- **morning**: schedule summary + overdue/today reminders + tasks awaiting
  review/approval + "the ONE thing": one sentence naming the most important
  focus, chosen by a single local-model pass (`localChatComplete`, temp 0,
  ≤120 tokens) over the assembled facts + the GOALS.md persona file if present
  (see persona dir used by flash). Model failure → omit the ONE thing line.
- **evening**: what completed today (tasks terminal since local midnight),
  what's still open/slipped, what's queued overnight.
- Output: plain text, ≤6 short lines, no markdown (goes to iMessage + TTS).
  Pure assembly separated from I/O (dep-injection like NotifyDeps) — unit
  tests with fake deps for both kinds, including empty-day and model-failure.

## Surface 1: morning contract / evening ledger texts
- Discover how `runDailyMomentOnce` / heartbeat scheduling works
  (`src/lib/flash/heartbeat.ts`, config get/set routes in server.ts ~696).
  Extend the SAME config/scheduling mechanism (no new scheduler) with two
  entries: morning (default 07:30) + evening (default 21:00) local time,
  each sending `composeDayBrief(kind)` via `notify()`. Respect an enable flag
  in the same config shape; default ON only if the existing heartbeat/daily
  moment defaults ON (match the codebase's posture — discover it).
- Idempotence per day (a restart at 07:31 must not double-text — persist
  last-sent day the same way heartbeat persists its own state).

## Surface 2: contextual live-call greeting
- `GET /voice/greeting` (token-gated like siblings): returns
  `{ text }` — a ≤2-sentence spoken greeting: time-of-day salutation + up to
  2 highest-signal facts (next meeting within 3h, count of items needing
  approval/review, most recent loop-closure since last voice session).
  Reuse day-brief internals; deterministic fallback "Hi — I'm ready." on any
  error. Must respond in <1.5s (no model call — assembly only).
- `voice-sidecar/flash_pipeline.py`: on client connect, fetch that endpoint
  (daemon URL/token env vars already exist for /flash/turn — see
  flash_llm.py DAEMON_URL) with a short timeout; speak the returned text as
  the greeting; on ANY failure speak the current static GREETING. Keep the
  change minimal and synchronous-safe (async fetch inside the greet handler).

## Surface 3: "while you were away" is Surface 2's third fact — no extra work
beyond including recent loop-closures in the greeting facts (above).

## Gate + delivery
- npm test / typecheck / scope-wall green; python: `python3 -m py_compile
  voice-sidecar/flash_pipeline.py` (venv deps may be unavailable — compile
  check is the bar, mirror existing sidecar changes).
- Commits on main (1–3 logical commits), push. Trailer:
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
