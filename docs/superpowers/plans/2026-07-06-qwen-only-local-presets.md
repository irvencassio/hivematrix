# Qwen-Only Local Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [ ] Add failing tests for memory-tier preset selection in `src/lib/models/local-engine.test.ts`.
- [ ] Add failing tests for provisioning writing `localModelPreset` and Qwen-fast primary in `src/lib/models/provision.test.ts`.
- [ ] Update model availability tests to remove DeepSeek/Dwarf Star selectable presets.
- [ ] Remove Dwarf Star provider/preset support from `src/lib/models/local-presets.ts`, `src/lib/config/providers.ts`, `src/lib/config/qwen-profile.ts`, and backend/status copy.
- [ ] Remove the native ds4-agent harness from orchestration and tests.
- [ ] Update observability to treat local models as one Qwen/local bucket.
- [ ] Update console/readiness/system copy to no longer detect or render Dwarf Star.
- [ ] Update `scripts/install-local-model.sh` to install/configure only Qwen/Rapid-MLX presets.
- [ ] Clean HiveMatrix-iOS DeepSeek wording in active docs/scripts, preserving unrelated existing version changes.
- [ ] Run focused tests, full gates, and Qwen readiness.
