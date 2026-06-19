# Role Model Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing tests in `src/lib/models/available.test.ts` for role option lists:
  - Coding includes Opus, Sonnet, GPT-5.5, Spark, and Qwen when all backends are configured.
  - Operational includes Qwen, Spark, and Sonnet when all backends are configured.
- [x] Add failing tests in `src/lib/routing/model-resolver.test.ts`:
  - Codex provider defaults Coding/frontier to Spark.
  - Codex provider still lets `frontierModel` override to GPT-5.5, Spark, Opus, Sonnet, or Qwen.
  - Operational override can point to Spark/Sonnet/Qwen.
- [x] Update `src/lib/models/available.ts`:
  - Add Sonnet, Codex Spark, and Codex GPT-5.5 constants where needed.
  - Add a `RoleModelOption` type and `buildRoleModelOptions(backends)` helper.
  - Include role options in `/models` via the server.
- [x] Update `src/lib/routing/model-resolver.ts`:
  - Let explicit `thinkModel` and `frontierModel` overrides win regardless of provider.
  - Make Codex provider Coding default Spark and Thinking default GPT-5.5.
  - Keep Claude provider defaults unchanged.
- [x] Update `src/daemon/console.ts`:
  - Stop hiding Thinking/Coding when provider is Codex.
  - Render role selects from `models.roleModelOptions`.
  - Update provider labels and default labels.
- [x] Update console tests in `src/daemon/console.test.ts` to assert Codex no longer hides role rows.
- [x] Update `docs/MODEL-ROUTING.md` to document provider defaults plus per-role overrides.
- [x] Run focused tests, then full verification gates.
