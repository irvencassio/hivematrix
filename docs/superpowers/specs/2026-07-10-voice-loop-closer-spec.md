# Voice Loop-Closer — spec (2026-07-10)

## Problem
When voice can't answer live, it says "I'm looking into it" and a task spawns
(via `routeVoiceSession` in `src/lib/voice/session.ts` → consumed by the
`/voice/sessions` POST route in `src/daemon/server.ts`, and via the flash
loop's `create_task` tool in `src/lib/flash/loop.ts` when `channel === "voice"`).
The task completes — **and the answer dies on the task board**. The operator
asked with their voice; the answer must chase them back. Until then, every
escalation is a silently dropped promise.

## Goal
A task that originated from voice delivers its outcome BACK to the operator,
unprompted, within seconds of completing:
1. **Message Lane text** (primary; the operator's allowlisted number) via the
   existing `notify()` (`src/lib/notify/notify.ts`) — it already fans out to
   iMessage/Telegram/email per config and respects lane enablement.
2. **APNs push** (secondary, best-effort) via `src/lib/notify/apns.ts` if
   devices are registered (`/devices/register` exists in server.ts).

## Design requirements

### 1. Mark voice origin at creation
- Discover exactly where the two voice paths create tasks and mark those tasks
  `origin: "voice"`. **Constraint (scope-wall):** do NOT create a new
  persistent store. Prefer an existing task field (inspect the task schema in
  `src/lib/db*` / wherever tasks are persisted — there may be a metadata/JSON
  column or an equivalent convention). If a schema change is unavoidable, it
  must be a column on the existing tasks table AND you must append a rationale
  entry to `DECISIONS.md` (the scope-wall check requires this).
- Both creation paths must be covered: session-close escalation AND flash
  `create_task` when the flash channel is "voice".

### 2. Close the loop on completion
- Find the daemon's task terminal transition (where a task's status becomes
  done/review after an agent run finishes — trace the task runner in
  `src/daemon/` / orchestrator). Hook there — one call site, not sprinkled.
- On terminal transition of a voice-origin task:
  - **Distill** the task result to ≤2 short spoken-style sentences. Use the
    local model via `localChatComplete` (`src/lib/models/chat-client.ts`,
    maxTokens ≤120, temperature 0); on any model failure fall back to a
    deterministic truncation (first ~200 chars of the result/title). Never
    block or throw into the task runner — fire-and-forget with caught errors.
  - **Send**: `notify("✅ <title>: <distilled>")` + best-effort APNs push with
    the same text. Failure tolerated (log, don't retry-loop).
- **Idempotence:** a task must never notify twice. Persist the fact it was
  notified using the same mechanism as `origin` (field/metadata), checked
  before sending.
- **Noise guard:** skip notification when the task failed/was cancelled with
  no usable result, or the result is empty — send "⚠️ <title> didn't finish —
  it's on the board" for failures instead (one line, still once only).

### 3. Tests (verification gate — hard requirement)
- Unit-test the pure pieces: origin marking decision, distiller fallback,
  idempotence guard, failure-path message. Follow the codebase's node:test
  style (see `src/lib/voice/session.test.ts` for conventions).
- `npm test`, `npm run typecheck`, `npm run scope-wall` must ALL pass.
- Do not weaken existing tests; extend expectations where lists/shapes change.

### 4. Out of scope
- No iOS/watch client changes (push payload = plain alert text).
- No spoken playback of the answer on next session (future work).
- No release; commit to main only.

## Acceptance walkthrough
1. Say (voice): "research the best e-bike under $2k" → sidecar/flash escalates
   → task spawns carrying voice origin.
2. Task's agent finishes with a result → within seconds the operator's phone
   receives one text: "✅ E-bike research: The Aventon Level.2 is the
   standout under $2k — full comparison is on your board." (+ APNs if
   registered)
3. Re-running/reopening the task does not re-text. A failed task texts the
   one-line failure notice instead.

## Delivery
Single commit on `main`, message explains the loop-closer; include
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Push after the
verification gate passes.
