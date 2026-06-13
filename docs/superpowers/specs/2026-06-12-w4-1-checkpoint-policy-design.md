# W4.1 Strategy / Checkpoint Policy — Design

Date: 2026-06-12
Status: Design for the final W4.1 hardening slice (after phase-3 failure replan, commit `0101905`).

## Problem

The Directive autonomy engine (`src/lib/orchestrator/directive-engine.ts`) walks a run
through `plan → execute → verify → reflect`. Today every run is fully autonomous: once a
plan is produced the engine immediately spawns execution tasks, and once the reviewer
passes it immediately proves criteria and reflects. There is no founder-in-the-loop gate.

The directive row already carries an `approvalPolicy` JSON column (db v6), but **nothing
reads it** — it is inert. Hive 1's mission engine had explicit checkpoint levels
(`none` / `strategy-only` / `full`); HiveMatrix has the safer proven-criteria ledger but
lost the checkpoint concept in the greenfield reset. This slice restores it.

This is the safety/control half of the WS1 thesis ("the agent platform you can text"):
a checkpoint pauses the run and escalates an approval request to the founder's phone via
the existing notify plane (W1.3); a tap/text approves or rejects.

## Approach

### Policy (pure, `directive-autonomy.ts`)

`parseDirectiveCheckpointPolicy(approvalPolicyJson)` → `{ level }` where level is:

- `none` — fully autonomous (default; current behavior, zero change).
- `plan` — pause **before execution**: the plan must be approved before any execution
  task is spawned (the "don't spend tokens / take real-world action unattended" gate).
- `full` — `plan` gate **plus** a completion gate before `verify → reflect`: the outcome
  must be approved before criteria are marked proven.

Accepts both the terse `{ "checkpoint": "plan" }` and nested `{ "checkpoint": { "level": "plan" } }`
shapes; unknown/missing → `none`.

### Gate mechanism (engine + approval store)

The engine resolves a checkpoint through a small resolver that returns
`approve | reject | pending`:

- **Tests** inject a resolver via `_setDirectiveCheckpointResolverForTests` (mirrors the
  planner/reviewer/retrospective injectors).
- **Production** reuses the existing file-based approval store (`approval.ts`):
  `requestCheckpointApproval()` writes one `${runId}-checkpoint-${gate}.json` request;
  the notify loop (W1.3) already escalates `getPendingApprovals()` to iMessage/Telegram
  and resolves taps through `resolveApproval()`, which writes the `.decision` file;
  `readCheckpointDecision()` maps it back to approve/reject. No new approval path, no new
  table. The store's 30-minute auto-deny timeout becomes a safe fail-closed default.

### Gate placement

- **Plan gate** (`plan` and `full`): inserted at every plan-production path in `planRun`
  (test-injected planner, production planner task, deterministic fallback) right before
  execution tasks are created. `hold` keeps the run in `plan` (and leaves the production
  planner task **unconsumed** so the plan persists across ticks); `reject` fails the run
  with `checkpoint_rejected`; `approve` proceeds to spawn tasks and enter `execute`.
- **Completion gate** (`full` only): inserted at every `verify → reflect` transition
  (test reviewer pass, production reviewer pass, deterministic prover) before criteria are
  proven. `hold` keeps the run in `verify` with the reviewer **unconsumed**; `reject` fails
  the run; `approve` proves criteria and reflects.

`checkpoint_pending` / `checkpoint_approved` are journaled once per (run, gate) so a held
run does not spam the journal each tick.

## Constraints

- Directives remain the only autonomy primitive; no new run phase, no new table.
- `none` directives are byte-for-byte unchanged (all existing tests stay green).
- Fail closed: a failed/denied/timed-out checkpoint never silently proceeds.
- Production wiring reuses the W1.3 notify plane and the existing approval store.

## Out of scope (carried forward)

- A distinct CEO **strategy** phase (go/no-go framing before planning) — the plan gate is
  the strategy-approval surface for now.
- Free-text founder edits to a plan at the checkpoint (approve/reject only).
- Per-task (rather than per-plan) approval granularity.
