# Voice Acts — calendar creation + voice approvals (2026-07-10)

Two features, two commits, one theme: voice can ACT on trusted things, live.

## Feature 1: `calendar_create` lane tool
Clone the proven `reminder_create` pattern (`src/lib/orchestrator/pim-tools.ts`).

- Tool: `calendar_create` — "put lunch with Sam on Friday at noon", "add a
  dentist appointment tomorrow at 2". Params: `title` (required), `when`
  (user's words, parsed by the existing `parseDuePhrase`), `durationMinutes`
  (optional, default 60).
- AppleScript: `tell application "Calendar"` → make new event at end of events
  of (a sensible default calendar — discover: first writable calendar, or
  named "Home"/"Calendar"; keep deterministic and document the choice) with
  start/end date built by explicit date components (same style as
  reminder_create — never locale date strings).
- No due phrase parse → return an error string asking for a time (an event
  needs a start; do NOT create all-day events silently).
- Register in lane-tools (capability "brain", same as other PIM tools),
  add to the routing guide line, and update the lane-tools test expectations
  (count + per-mode lists — see how PIM_NAMES was added in
  `src/lib/orchestrator/lane-tools.test.ts`).
- Do NOT add to READ_ONLY_FLASH_TOOLS (it's a write).
- Unit tests: date-component correctness for a fixed `parseDuePhrase` result,
  refusal without a time, osascript failure surface. Mirror pim-tools.test.ts.

## Feature 2: voice approvals
Voice verb to act on pending approvals — highest trust-leverage quick win.

- Discover `src/lib/voice/command-turn.ts` (`commandTurnOverride`) — the
  deterministic command layer that runs BEFORE flash on `/voice/turn`
  (`src/daemon/server.ts` ~line 3399). Add verbs:
  - "what needs approval / any approvals?" → list pending approvals (reuse
    whatever `/approvals/pending` uses internally — import the lib function,
    don't fetch loopback) as one short spoken sentence each with an index:
    "Two pending: one, mail draft to Bob; two, browser step on Chase."
  - "approve the first one / approve the mail draft / approve number two" →
    resolve that approval (approve). "deny/reject …" → deny. Match by index,
    kind keyword, or unique substring; if ambiguous ("approve it" with 3
    pending), reply asking which — never guess.
- Resolution must go through the SAME code path the watch's
  `/approvals/resolve` route uses (find it in server.ts) so audit/semantics
  stay identical. Source label: "voice".
- Safety: only act when there ARE pending approvals; exact confirmations in
  the spoken reply ("Approved: mail draft to Bob."). No new state.
- Unit tests for the matcher (pure): index/kind/substring/ambiguous/none.

## Gate + delivery (both features)
- `npm test` + `npm run typecheck` + `npm run scope-wall` all green; extend
  existing test expectations rather than weakening.
- Two commits on `main` (one per feature), push. End commit messages with:
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
