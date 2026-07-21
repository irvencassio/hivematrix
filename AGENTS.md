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

### The model stack you are working inside

HiveMatrix is **Claude-native since 2026-07-11** (0.1.176). The local Qwen /
LM Studio / Rapid-MLX plane was deleted — `src/lib/local-model/` and
`src/lib/config/qwen-profile.ts` do not exist, and there is no local inference
fallback. Every text role resolves to a Claude model through the `claude` CLI on
the operator's subscription — **no API key, no `@anthropic-ai` SDK, ever**:
`think` → `frontier-premium` → **Opus**; `code-critical` → `frontier` →
**Sonnet**; `execute`/`cheap-web`/`converse` → `operational` → **Haiku**; `image`
→ `nanai` → Nano Banana. In `local-only`/`offline` every text role is
`unavailable` — work queues, it never degrades to a weaker model.

Source of truth: `src/lib/connectivity/policy.ts` (role→tier),
`src/lib/routing/model-resolver.ts` (tier→model id), `src/lib/models/available.ts`
(role slots), `src/lib/models/backends.ts` (CLI detection); prose in
`docs/MODEL-ROUTING.md`. Superpowers discipline is **non-negotiable when you touch
routing** — those files, connectivity postures, or the Flash loop:

- **Routing is load-bearing for everything else.** A wrong tier silently sends the
  system's grind to Opus, or judgement work to Haiku. Regressions are invisible at
  runtime and surface as cost/quality drift weeks later — watch the test fail first.
- **Never reintroduce the removed stack.** No local serving supervisor, no local
  OpenAI-compatible text endpoint, no `ANTHROPIC_API_KEY`, no SDK. Config keys
  `qwen`/`localModel`/`localEngine` are dead and stripped by
  `src/lib/config/migrate.ts` — it names them on purpose; leave it alone.

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

### Red Flags — Stop and Use Superpowers If You Catch Yourself

| Thought | Reality |
|---------|---------|
| "This is a small change, I'll just do it" | Small changes are where assumptions rot. Brainstorm first. |
| "I know what the code should look like" | Knowing ≠ testing. Write the failing test first. |
| "The plan is obvious, skip to implementation" | The plan is the artifact. Save it. |
| "The model can figure this out without a detailed plan" | The plan is the constraint that keeps execution on the design. Without it you get the model's improvisation, not your intent. |

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
