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
