# HiveMatrix

Greenfield reset of Hive 1. Phase 0 — repo cut with transplanted subsystems.

See [COMPONENT-MAP.md](COMPONENT-MAP.md) for the enforced taxonomy and [DECISIONS.md](DECISIONS.md) for the six closed design decisions.

## Phase 0 status

Transplanted subsystems (with tests):
- `src/lib/orchestrator/` — generic OpenAI-compatible agent loop, tool bridge, subprocess routing
- `src/lib/local-model/` — health probing (streaming + tool-call + readiness gate)
- `src/lib/brain/` — memory bundle assembly, settings, selection
- `src/lib/db/` — SQLite schema with directive/run/run_journal tables and verified-completion ledger
- `src/lib/session/` — session/identity plane (internal; no public brand)
- `src/lib/desktopbee/` — DesktopBee capability contracts (renamed from ComputerBee)
- `src/lib/central/` — worker contracts
- `src/lib/config/` — providers (Google removed), agent profiles, budget policy
- `src/lib/bees/` — capability catalog (scoped: TermBee, BrowserBee, WebBee, DesktopBee)

CI runs: scope-wall check → typecheck → tests.

## Key docs

| Doc | Purpose |
|-----|---------|
| [COMPONENT-MAP.md](COMPONENT-MAP.md) | Enforced taxonomy (CI-checked) |
| [DECISIONS.md](DECISIONS.md) | Six closed design decisions |
| [DIRECTIVE-PRIMITIVE.md](DIRECTIVE-PRIMITIVE.md) | Directive/Run data model spec |
| [QWEN-LOCAL-PROFILE.md](QWEN-LOCAL-PROFILE.md) | M5 Max 128GB local model targets |
