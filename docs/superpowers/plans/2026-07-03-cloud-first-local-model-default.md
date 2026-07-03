# Cloud-First Local Model Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing setup/onboarding tests.
  - File: `src/lib/onboarding/setup-status.test.ts`
  - File: `src/lib/onboarding/onboarding.test.ts`
  - Expected: local-capable idle provisioning is `not_requested`, and a config-only cloud-first install satisfies the required local-model step.

- [x] Add failing provisioning tests.
  - File: `src/lib/models/provision.test.ts`
  - Expected: a pure helper creates a `qwen` profile from a Rapid-MLX plan, prefers the `coding` tier, and preserves an existing profile.

- [x] Add failing readiness script test.
  - File: `scripts/qwen-readiness.test.mjs`
  - Expected: no `~/.hivematrix/config.json` or no `qwen` profile exits 0 with a skip message.

- [x] Implement cloud-first setup defaults.
  - File: `src/lib/onboarding/setup-status.ts`
  - File: `src/lib/onboarding/onboarding.ts`
  - Behavior: local model setup remains actionable but is not a blocking error by default.

- [x] Implement Rapid-MLX Qwen profile defaults.
  - File: `src/lib/models/provision.ts`
  - Behavior: provisioning writes a `qwen` profile only when missing, using local OpenAI-compatible Rapid-MLX endpoints.

- [x] Implement no-profile readiness skip.
  - File: `scripts/qwen-readiness.mts`
  - Behavior: no profile is "not applicable" and exits 0; configured unhealthy profiles still fail.

- [x] Verify.
  - Run focused tests first.
  - Run `npm run typecheck`.
  - Run `npm test`.
  - Run `node scripts/scope-wall.mjs`.
  - Run `npx tsx scripts/qwen-readiness.mts`.
  - Run `npm run verify:daemon-runtime`.
  - Run `git diff --check`.
