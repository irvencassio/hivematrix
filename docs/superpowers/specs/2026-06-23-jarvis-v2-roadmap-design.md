# Jarvis V2 Voice Roadmap Design

## Context

The v1 voice command layer lets push-to-talk drive the board, approvals,
directives, task creation, and connectivity. The remaining roadmap asks for voice
to behave more like an operator surface: remember the recent spoken context,
disambiguate approvals, run more actions, brief the founder proactively, and add
safety-gated automation without silently approving risky external work.

Current useful surfaces:

- `/voice/turn` already runs skill override, then command override, then LLM.
- `/approvals/pending` and `/approvals/resolve` expose the unified approval
  queue.
- `/tasks/:id/retry`, `PATCH /tasks/:id`, `/directives`, `/usage`, and
  `/metrics` already provide most of the action IO.
- iOS already has a prominent mic button when the Voice feature is enabled.

## Goals

1. Preserve deterministic voice command handling before the conversational LLM.
2. Add a short rolling voice context so follow-ups such as "approve it" and "the
   second one" resolve predictably.
3. Ask for clarification instead of resolving ambiguous approval requests.
4. Add deterministic actions for named skills, directives, task retry/model
   changes, release verification, and usage/analytics.
5. Add spoken briefings for "good morning", "brief me", and "what needs me".
6. Add an opt-in auto-approval policy for low-risk categories only.
7. Keep iOS and desktop voice surfaces first-class without adding an always-on
   listener in this pass.

## Non-Goals

- No silent auto-send/post/spend behavior.
- No LLM-based command parsing for safety-critical actions.
- No lock-screen or always-listening iOS entitlement work in this pass.
- No release publishing from voice; voice can queue/run verification work only.

## Approach A: Deterministic Jarvis V2 Layer

Extend the existing command layer with small pure modules:

- `src/lib/voice/command-context.ts`
  - In-memory rolling context keyed by a session id, defaulting to the single
    push-to-talk session.
  - Stores recent turns, last listed approvals, focused approval, and last task.
- `src/lib/voice/command-intent.ts`
  - Adds explicit action kinds and ordinal parsing.
  - Keeps spoken phrases deterministic.
- `src/lib/voice/briefing.ts`
  - Builds a concise spoken standup from task counts, approvals, directives,
    metrics, and usage.
- `src/lib/voice/auto-approval-policy.ts`
  - Parses a persisted opt-in policy and decides whether an approval category can
    be auto-approved.

`command-turn.ts` remains the IO boundary. It reads the pure intent, consults
context, performs action IO, synthesizes speech, and updates context.

## Safety Model

Approval resolution changes from "oldest actionable wins" to:

- If there is exactly one actionable approval, "approve it" / "deny it" resolves
  it.
- If a prior voice turn listed approvals, "approve it" resolves the focused item.
- If the user says "first", "second", or another ordinal, resolve that item.
- If multiple approvals exist and no target can be inferred, ask the user to pick
  one.

Auto-approval is opt-in and category-limited:

- Allowed categories: checkpoints and low-risk tool gates only.
- Explicitly excluded categories: content/external comms, posting, spend, and
  unknown tools.
- The policy is surfaced through feature settings and used by voice command
  replies, but outward-facing actions remain confirm-by-default.

## iOS Surface

The existing floating mic button remains the primary phone surface. This pass
will make the "voice off" state visible on the phone with a disabled mic affordance
that explains Voice must be enabled on the Mac, so Talk is no longer invisible
when disabled. Lock-screen and always-listening work stays as a follow-up because
it needs entitlement/product decisions.

## Verification

- Add failing tests for pure intent/context/briefing/policy behavior first.
- Add command-turn tests with injected dependencies where practical.
- Run `npm run typecheck`.
- Run `npm test`.
- Run `node scripts/scope-wall.mjs`.
- Because this touches voice control but not local-model routing internals, run
  `npx tsx scripts/qwen-readiness.mts` if local model configuration is available
  after the normal gates.
