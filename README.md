# HiveMatrix

An always-on, single-Mac **autonomous operations platform**. A headless daemon
(launchd-supervised) runs directives — standing objectives that plan, execute,
verify, reflect, and re-arm 24×7 — routing work between a frontier model and a
local Qwen model under a connectivity policy, with a native desktop-control
capability (Desktop Lane), a signed/notarized app shell, and a self-update channel.

Greenfield reset of Hive 1. The design is locked by [DECISIONS.md](DECISIONS.md)
and a CI-enforced [COMPONENT-MAP.md](COMPONENT-MAP.md) scope wall.

## Architecture at a glance

```
launchd ─▶ Hive daemon (Node, :3747) ──┬─ scheduler + directive run engine
                                        ├─ connectivity policy (cloud-ok│local-only│offline)
                                        ├─ role→tier→model router
                                        ├─ REST + SSE API
                                        └─ SQLite (tasks/directives/runs) + verified-completion ledger
   console (SPA, served at / )  ◀───────┘
   Tauri .app shell  ◀── loads the console
   Desktop Lane helper (.app, :3748) ◀── AX / CGEvent / capture / AppleScript, approval-gated
   Rapid-MLX (:8000 fast · :8001 coding) ◀── Qwen3.6 4-bit tiers (LM Studio/Ollama also work)
```

## Prerequisites

- macOS 12+ (built/run on Apple Silicon, M-series)
- Node 22 (`nvm` ok); for the app shell: Rust + `cargo-tauri`, Xcode
- Local model plane: **Rapid-MLX** (the on-device engine; LM Studio / Ollama are
  drop-in OpenAI-compatible alternates). The daemon sizes + serves it per machine.
- For signed builds: a Developer ID Application cert + a notarytool keychain
  profile (see [docs/UPDATE-CHANNEL.md](docs/UPDATE-CHANNEL.md))

## Quickstart

```bash
npm install
npm run typecheck && npm test       # gates: tsc, node --test
node scripts/scope-wall.mjs         # taxonomy scope wall (expect 0 violations)

# Run the daemon (foreground, dev)
npx tsx src/daemon/index.ts         # serves http://127.0.0.1:3747

# Or supervise under launchd (production)
#   render scripts/launchd/com.hivematrix.daemon.plist.template → ~/Library/LaunchAgents
#   launchctl load -w ~/Library/LaunchAgents/com.hivematrix.daemon.plist
```

Open the operator console at **http://127.0.0.1:3747/** (board · session ·
context/brain, with live soak/health + a setup checklist).

### Local model (Rapid-MLX two-tier)

The local plane is **Rapid-MLX** serving two resident Qwen3.6 4-bit tiers —
`fast` (35B-A3B, :8000, reasoning off) for daily/agentic/voice and `coding`
(27B-dense, :8001) for hard coding — sized to the machine's RAM. Provision it
for this Mac (installs the engine + pulls only the tiers that fit, writes
`~/.hivematrix/config.json` `localEngine`):

```bash
npx tsx scripts/provision-local-engine.mts            # plan (dry run)
npx tsx scripts/provision-local-engine.mts --apply    # install + pull + configure
```

Canonical reference: [docs/MODEL-ROUTING.md](docs/MODEL-ROUTING.md). LM Studio /
Ollama remain valid alternates (`localEngine.engine`). To prove a configured
local model is ready:

```bash
npx tsx scripts/qwen-readiness.mts   # 6-check readiness gate + eval suite
```

### Build the signed app

```bash
npm run autodeploy                 # increment version, commit, push, build, publish update feed
cargo tauri build                    # signed HiveMatrix.app (Developer ID, hardened runtime)
bash scripts/build-app.sh            # notarize the .app via the `hivematrix` profile
bash scripts/build-dmg.sh            # notarized drag-to-install .dmg (hdiutil, GUI-free)
```

## Setup & operations

- **First-run / readiness**: [ONBOARDING.md](ONBOARDING.md). Live status at
  `GET /onboarding`.
- **Updates**: [docs/UPDATE-CHANNEL.md](docs/UPDATE-CHANNEL.md) — cutting a
  release, Ed25519 key rotation, PAT scoping for a private channel.
- **Desktop Lane**: native helper in `desktopbee-helper/` (`swift build`,
  `bash build-app.sh`). Proof: `npx tsx scripts/desktopbee-proof.mts`.
- **Soak**: `npx tsx scripts/seed-soak.mts` seeds recurring directives;
  `npx tsx scripts/soak-scenarios.mts` injects + verifies failure recovery.

## Key docs

| Doc | Purpose |
|-----|---------|
| [COMPONENT-MAP.md](COMPONENT-MAP.md) | Enforced taxonomy (CI-checked) |
| [DECISIONS.md](DECISIONS.md) | Closed design decisions |
| [DIRECTIVE-PRIMITIVE.md](DIRECTIVE-PRIMITIVE.md) | Directive/Run data model |
| [QWEN-LOCAL-PROFILE.md](QWEN-LOCAL-PROFILE.md) | Local model targets + profile |
| [ONBOARDING.md](ONBOARDING.md) | First-run provisioning |
| [docs/UPDATE-CHANNEL.md](docs/UPDATE-CHANNEL.md) | Release/update runbook |

## Daemon API (selected)

`GET /health` · `GET /metrics` · `GET /onboarding` · `GET /connectivity` ·
`POST /connectivity/mode` · `GET|POST /tasks` · `GET|POST /directives` ·
`POST /directives/:id/criteria` · `GET /update/check` · `GET /events` (SSE).

CI gate (every change): scope-wall → typecheck → tests.
