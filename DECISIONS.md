# HiveMatrix Design Decisions

Date closed: 2026-06-11. All six reset questions are closed.

## Q1 — DesktopBee naming

**Decision:** DesktopBee. ComputerBee name is retired everywhere.
**Code:** `src/lib/desktopbee/` — all types use `DesktopBee*` prefix.

## Q2 — Local Qwen hardware

**Decision:** M5 Max 128GB unified memory, no LAN GPU box. Primary serving stack: MLX-first (mlx-lm server or Rapid-MLX), llama.cpp/GGUF fallback. vLLM deferred unless a LAN Linux/GPU box appears.
**Code:** `src/lib/local-model/health.ts` readiness gate extended in Phase 2. See [QWEN-LOCAL-PROFILE.md](QWEN-LOCAL-PROFILE.md).

## Q3 — Frontier default

**Decision:** Claude as the selectable default frontier model. OpenAI remains selectable. Google models removed except Nano Banana (image role, cloud-ok) and mflux local fallback.
**Code:** `src/lib/models/catalog.ts` — ModelOption type has no gemini-pro/flash entries.

## Q4 — Update channel trust

**Decision:** Signed, notarized .app from day one. No git-based updater. Tauri shell from Phase 1 with Sparkle/Tauri-updater channel. Daemon-side migrate-backup-restart-probe-rollback design is unchanged inside the signed bundle.
**Code:** Phase 1 work. No updater code in Phase 0.

## Q5 — Nano Banana offline

**Decision:** Nano Banana (cloud) is the primary image-role provider when `cloud-ok`. Local MLX fallback: mflux (FLUX.2 Klein / Qwen-Image class, draft/asset-grade) in `local-only` and `offline` modes.
**Code:** Router role `image` in Phase 2. `nano-banana` entry retained in catalog.

## Q6 — Mission primitive

**Decision:** Mission is retired. The long-horizon autonomy unit is the **Directive** (standing objective + proven success criteria + trigger/budget policy + recoverable run loop). Mission tables are not ported.
**Code:** `src/lib/db/index.ts` has `directives`, `runs`, `run_journal`, `directive_criteria` tables. No missions table.

---

Proposals for future phase boundaries go below this line. Nothing above is re-opened without a new decision entry.
