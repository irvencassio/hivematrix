# Task Git-Failure Rollback & Escalation Design

## Context

On July 8, 2026, a HiveMatrix task titled "Canopy Agent Core Phase 1 Design"
(project path `/Users/irvcassio/Canopy`) showed `failed` after two git errors:

```
fatal: pathspec 'Tests/CanopyAgentCoreTests/AppStateAgentCoreTests.swift' did not match any files
---
The following paths are ignored by one of your .gitignore files:
agent/dist
hint: Use -f if you really want to add them.
```

Investigation (grepping `src/lib` for any script constructing `git add`
commands for Canopy tasks, and checking `.claude/worktrees` for a stale
worktree) found **no hardcoded pipeline bug**. The task's executor ran a
compound `git add <test-file> <plan-doc> agent/dist/ && git diff --staged
--stat` directly against the live repo. `agent/dist/` is gitignored, so
`git add` refused it and the `&&` chain aborted — but git had already
staged the two valid paths before erroring, so real, correct work (four new
`AppStateAgentCoreTests.swift` test cases, later verified via `swift build`
+ `swift test` to compile and pass; checkbox bookkeeping on the phase-1 plan
doc) was left stranded mid-commit with no further action taken. The task
board simply recorded `FAILED`. Root cause is a one-off tool-use mistake by
the task's executor (consistent with the local-model coding failure class
already documented in `2026-07-06-hivematrix-task-pipeline-review.html`
§3c: "Failure is a dead end by policy... the human is the escalation path").

This is not about that specific git-add call — a narrower fix (e.g.
special-casing `agent/dist/`) would not generalize. The actual gap is
structural: **any task that attempts a git commit as part of its work has
no recovery path when the git step itself fails.** It either fully
succeeds or leaves the target repository in an undefined, uninspected
state and reports `FAILED` with no diagnostic package for whoever looks at
it next.

## Approved Approach

Wrap every task-initiated git commit sequence in a **safe-commit helper**
that treats "stage → verify → commit" as one transaction, and produce a
structured **escalation package** on any failure instead of a bare
`FAILED` status. This generalizes the `R2` "escalation package" idea
already proposed (but not built) in the July 6 pipeline review.

### 1. Safe-commit helper

A single function/step (not per-task boilerplate) that a task's executor
calls instead of hand-rolling `git add && git commit`:

- Accepts an explicit list of paths intended for staging.
- Stages each path individually, not as one compound command — a single
  bad path must not prevent valid paths from being evaluated, and the
  helper must know exactly which paths succeeded and which didn't (today's
  incident depended on undocumented git behavior — that valid paths in a
  multi-path `git add` still get staged even when one path errors — to
  avoid losing work; that should be an explicit, tested guarantee of the
  helper, not an accident of git's own semantics).
- Before staging a path, check it against the repo's `.gitignore`
  (`git check-ignore`) and skip it with a logged reason rather than
  attempting to force it — a task should never need `-f` to commit its own
  legitimate output. If a task's own build step produces gitignored
  artifacts, that is a signal the task's path list is wrong, not that the
  ignore rule should be bypassed.
- After staging, run the repo's existing verification for the touched
  language/surface (e.g. `swift build` + relevant `swift test --filter`
  for a Swift change) before committing. Failure here rolls back (see
  below) rather than committing broken or unverified state.
- On success: commit with a message, and report the resulting commit hash.
- On any failure at any step: **roll back to the exact state the task
  found the repo in** (`git reset` the index for paths this run staged;
  never touch pre-existing staged/unstaged state the task didn't create)
  and emit the escalation package below. A task must never leave a repo
  either half-staged or holding a broken commit.

### 2. Escalation package

On safe-commit failure (or any other terminal task failure), instead of
writing a bare `FAILED` row, emit a structured artifact containing:

- The original task spec/prompt.
- The task's draft output (the actual file diffs it produced, whether or
  not they were committed).
- The specific failure: which step failed, the exact error text, and
  which paths (if any) were left uncommitted-but-verified-safe vs.
  uncommitted-and-unverified.
- A recommended next action: `retry`, `needs human review`, or (for a
  git-mechanics failure specifically, as in this incident) `content is
  verified safe — finish the commit`.

This package is what a human (or a future frontier-review-debt task, per
the existing `frontier-debt.ts` auto-fire mechanism) picks up instead of a
bare `FAILED` board entry with no context. It does not require building
the full `R2` primitive described in the July 6 review (typed artifact
consumable by any harness) — this design's package can start as a JSON
file alongside the task record and generalize later if `R2` is pursued.

### 3. Non-goals

- This does not change how tasks are routed (local vs. frontier) or touch
  the intake/decomposition layer discussed in the July 6 review.
- This does not attempt to make git operations themselves smarter about
  *what* to stage (e.g. inferring a correct path list) — it only makes an
  attempted commit safe to retry or hand off when it goes wrong. Path-list
  correctness remains the executor's responsibility.
- This does not resurrect the `R2` "typed escalation artifact used by any
  harness" as a general primitive — that remains a larger, separate
  initiative if wanted later. This design's package is scoped to git-commit
  failures only.

## Testing

- Unit test the safe-commit helper directly: a path list containing one
  gitignored path and two valid paths results in the two valid paths
  staged, the gitignored path skipped with a logged reason, and (assuming
  verification passes) a successful commit — no aborted chain, no lost
  work.
- A verification failure (e.g. a deliberately broken test) after staging
  results in a full rollback: `git status` after the run matches `git
  status` before the run, byte for byte.
- An end-to-end test against a scratch repo reproduces this incident's
  exact scenario (stage a real file + a gitignored directory) and asserts
  the outcome is a clean commit of the real file plus a skip-reason log
  entry for the ignored path, never a `FAILED` task with a dirty working
  tree.

## Relationship to the July 6 pipeline review

This design directly answers one line item from that review's §3c ("Failure
is a dead end by policy") without taking on the larger, more speculative
`R2`/`R6` proposals in that same document. It is intentionally the smallest
fix that closes the specific gap this incident exposed, in keeping with
that review's own recommendation (§7, S6) to add a standing complexity
budget rather than growing new machinery per incident.
