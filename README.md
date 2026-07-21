# HiveMatrix

An always-on, single-Mac **autonomous operations platform**. A headless daemon
(launchd-supervised) runs directives — standing objectives that plan, execute,
verify, reflect, and re-arm 24×7 — routing work by role across the Claude model
tiers under a connectivity policy, with a native desktop-control
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
   `claude` CLI (subscription OAuth) ◀── Opus · Sonnet · Haiku by role (no API key, no SDK)
```

## Prerequisites

- macOS 12+ (built/run on Apple Silicon, M-series)
- Node 22 (`nvm` ok); for the app shell: Rust + `cargo-tauri`, Xcode
- Model plane: the **`claude` CLI** signed in on a Claude subscription (the
  `codex` CLI is an optional alternate frontier provider). No API keys.
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

### Model plane (Claude-native)

Since 0.1.176 (2026-07-11) every text role runs on Claude through the `claude`
CLI on the operator's subscription — **no API key, no SDK**, and no local
inference plane (the Qwen / LM Studio / Rapid-MLX stack was removed):

| Role | Model |
|------|-------|
| thinking (plan / review / architecture) | Opus |
| coding (what ships) | Sonnet |
| operational + Flash chat / voice | Haiku |
| image | Nano Banana |

Install the CLI and sign in (`claude`); `GET /onboarding` reports it as the
required **frontier** step. With no frontier CLI reachable, text roles are
`unavailable` and work queues rather than degrading. Canonical reference:
[docs/MODEL-ROUTING.md](docs/MODEL-ROUTING.md).

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
| [docs/MODEL-ROUTING.md](docs/MODEL-ROUTING.md) | Role → tier → model routing |
| [ONBOARDING.md](ONBOARDING.md) | First-run provisioning |
| [docs/UPDATE-CHANNEL.md](docs/UPDATE-CHANNEL.md) | Release/update runbook |

## Daemon API (selected)

`GET /health` · `GET /metrics` · `GET /onboarding` · `GET /connectivity` ·
`POST /connectivity/mode` · `GET|POST /tasks` · `GET|POST /directives` ·
`POST /directives/:id/criteria` · `GET /update/check` · `GET /events` (SSE).

CI gate (every change): scope-wall → typecheck → tests.
