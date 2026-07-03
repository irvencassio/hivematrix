# HiveMatrix Gates Ledger

This ledger is the source of truth for phase-gate claims in release notes. A
release note that claims a phase milestone, such as "Phase 1" or "M1", must have
that phase row marked `PASSED` before `scripts/release.mjs` will publish it.

Last seeded: 2026-07-03

## Current Status

Phase 3 and Phase 4 implementation code shipped in `v0.1.120` / `v0.1.121`
before the Phase 1 exit gate was complete. That is intentional history, not a
passed gate. Until a row below is `PASSED`, release notes should describe
specific implementation slices rather than claiming the phase itself has landed.

| Phase | Milestone | Gate Definition | Status | Evidence Link | Date Passed | Commit |
|---|---|---|---|---|---|---|
| Phase 1 | M1 - Flash Lane, Voice Runtime, OpenClaw Removal | Parity eval >=90%; voice latency measured and meets target or explicitly waived; zero live OpenClaw code across HiveMatrix repos; persona continuity verified. | UNMET | `eval/flash-parity/report.html` pending; `eval/flash-parity/prompts.jsonl` pending; OpenClaw live-code grep still finds references in `src/lib/openclaw/` and daemon routes. | - | v0.1.121 baseline |
| Phase 2 | M2 - Autonomy Rails, Credential Vault, Presence Layer | CI canary leak test green; kill switch halts running work in <2s; 48h local-only soak clean; presence recap delivered to phone. | UNMET | Pending: CI leak test, kill-switch drill, local-only soak report, recap proof. | - | - |
| Phase 3 | M3 - Buyable Packaging and Store Distribution | Stranger install <15m without terminal; first live transaction; Pro license unlock verified; store submission in review; privacy/terms/security pages published. | UNMET | Partial implementation shipped, but stranger test, transaction, and store-review evidence are not recorded. | - | v0.1.121 baseline |
| Phase 4 | M4 - Outcome Packs and Dogfood Gate | Pack infrastructure and two first-party packs run on real business for 7 consecutive days with zero destructive incidents; audit/activity trail supports public-beta demo. | UNMET | Pack infrastructure shipped in `v0.1.121`; 7-day dogfood and real pack-output evidence are not recorded. | - | 608aed117f995eadb8ae67d42daa9ba7b51af620 |

## How To Mark A Gate Passed

1. Add the durable evidence path or URL in `Evidence Link`.
2. Change `Status` to `PASSED`.
3. Fill `Date Passed` using `YYYY-MM-DD`.
4. Fill `Commit` with the commit that contains or links the evidence.
5. Run `npm run typecheck`, `npm test`, and `npm run scope-wall` before release.
