# AGENTS.md — HiveMatrix Coding Flow

> This file is read by coding agents (Codex, Claude Code, Cursor, etc.) before any action.
> It establishes mandatory workflows for this repository.

## Mandatory: Superpowers Workflow

All coding work in this repository **must** follow the [Superpowers](https://github.com/obra/superpowers) methodology. This is not optional.

### The Pipeline

```
brainstorming → writing-plans → subagent-driven-development → finishing-a-development-branch
```

1. **brainstorming** — Before writing any code. Explore context, ask questions one at a time, propose 2-3 approaches, present design in sections, get approval. Save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

2. **writing-plans** — After design approval. Break work into bite-sized tasks (2-5 min each). Every task has exact file paths, complete code samples, failing test first. Save to `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.

3. **subagent-driven-development** (or **executing-plans**) — Execute the plan. Fresh subagent per task. Two-stage review after each: spec compliance, then code quality. Continuous execution — don't pause between tasks.

4. **test-driven-development** — During implementation. RED-GREEN-REFACTOR. Write failing test, watch it fail, write minimal code, watch it pass. **No production code without a failing test first.**

5. **requesting-code-review** — Between tasks. SHA-based diff review with severity classification.

6. **finishing-a-development-branch** — When all tasks complete. Verify tests, merge/PR decision, cleanup.

### Why This Is Especially Critical for the Local Qwen Model

HiveMatrix routes work between a frontier model (Claude) and a local Qwen 3.6 27B model served via LM Studio on this Mac. When the coding agent is working on **local-model features** (anything under `src/lib/local-model/`, `src/lib/config/qwen-profile.ts`, `src/lib/models/backends.ts`, readiness gates, fallback logic, LM Studio integration), Superpowers discipline is **non-negotiable**:

- **Qwen 27B is less capable than Claude** for complex autonomous reasoning. A well-specified plan compensates for weaker model judgment — the plan carries the design intent, not the model's improvisation.
- **TDD is your safety net.** With a less capable model, subtle regressions are more likely. Watching tests fail before implementation is the only reliable way to verify correctness.
- **The local model path touches real hardware.** LM Studio, MLX, decode rates, context limits — these are integration surfaces where "it works on my machine" is not a test. The readiness gate (`scripts/qwen-readiness.mts`) must be part of the verification step.
- **Plan review prevents drift.** When the model is doing the heavy lifting, it can silently introduce scope creep or incorrect assumptions. The two-stage review (spec compliance, then code quality) catches this.

### Output Paths

- Design docs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Implementation plans: `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
- Tests: `tests/` mirroring `src/` structure

### Plan Header Template

Every implementation plan must start with:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
```

### Verification Gates

Before declaring work complete:
1. `npm run typecheck` — zero errors
2. `npm test` — all tests passing
3. `node scripts/scope-wall.mjs` — zero violations
4. For local-model changes: `npx tsx scripts/qwen-readiness.mts` — all 6 checks pass

### Red Flags — Stop and Use Superpowers If You Catch Yourself

| Thought | Reality |
|---------|---------|
| "This is a small change, I'll just do it" | Small changes are where assumptions rot. Brainstorm first. |
| "I know what the code should look like" | Knowing ≠ testing. Write the failing test first. |
| "The plan is obvious, skip to implementation" | The plan is the artifact. Save it. |
| "Qwen can handle this without a detailed plan" | The coding agent writes the plan; Qwen executes it. The plan is the constraint that keeps Qwen on track. |

## Complexity Budget — Fewer Concepts, Not More Tests

HiveMatrix is maintained by one person. Complexity is the top predictor of "things
break as tweaks and enhancements land," so new complexity must be a conscious,
documented choice — not a quiet addition. Part of this is enforced by the scope-wall;
the rest is expected of you.

The kernel is five concepts — **Event, Task, Directive, Policy, Persona/Memory** — and
everything else is an adapter over them (see DECISIONS.md Q14, the Subtraction Pass).

1. **No new persistent store, orchestration primitive, or product concept without a
   DECISIONS.md entry that names what it replaces or deletes.** A new store (a
   `CREATE TABLE` outside the two sanctioned schema files, `db/index.ts` and
   `brain/index-db.ts`) fails the scope-wall — that's a prompt to write the decision,
   not to work around the check.
2. **Reuse the shared scaffolding; don't re-roll it.** Interval loops →
   `startPollLoop` (`lanes/poll-loop.ts`). The auto-approval decision → `decidePolicy`
   (`approvals/decide-policy.ts`). Broad/multi-step work → a Task with `workflow:"work"`
   (the frontier harness self-plans via Superpowers), never a bespoke decomposer.
3. **The one-maintainer test.** If you can't re-explain a subsystem in one paragraph
   after a month away, it's too big — split or delete before adding to it.

When a change adds a concept, say in the commit what it deletes. When the same outcome
can come from extending an existing primitive instead of adding one, extend.

## Git hygiene — the working tree is SHARED

Agents, the operator, and other agents all act on the same checkout. Two rules
follow from that, and both were learned the hard way on 2026-07-18.

1. **Stage explicit paths. Never `git add -A` or `git add .`.**
   Another task's finished-but-uncommitted work is routinely sitting in the tree
   waiting for operator review. `git add -A` sweeps it into *your* commit under
   *your* message. This happened: a harness fix swallowed ~900 lines of an
   unrelated feature (its plan, specs, console, server and orchestrator changes)
   and would have shipped it inside an unrelated release had the release script
   not refused to build off a non-main branch. Stage the files you actually
   touched, by name.

2. **Commit your own work before you finish. Never leave it loose in the tree.**
   Uncommitted work is the unit that gets clobbered. Commit to the branch you
   were started on, or to `hive/task-<taskId>` if you created one. A task that
   reaches review with its changes committed cannot be swept by anyone, and the
   operator gets a reviewable diff instead of a pile of modified files.

3. **Never merge to main, and never resolve a merge conflict.**
   The operator integrates and releases. A merge requires knowing the intent of
   *both* sides, and you only authored one — which is precisely why model-driven
   merges go wrong. If integration is genuinely needed, it must be fast-forward
   only (`scripts/integrate-task-branch.sh`), which either succeeds cleanly or
   stops for a human. A conflict is an escalation, not a puzzle to solve.
