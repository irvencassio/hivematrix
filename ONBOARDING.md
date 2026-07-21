# HiveMatrix Onboarding

First-run provisioning for a single-Mac install. The daemon exposes a live
readiness checklist at `GET /onboarding` (also shown as the "Setup" strip in the
console); this document is the human walkthrough for each step.

Required steps gate a green first run; optional steps unlock extra capability.

## 1. Configuration file (required)

Create `~/.hivematrix/config.json`. Model routing needs no config at all — the
role defaults (Opus / Sonnet / Haiku) resolve from the installed CLI, so a
minimal config only carries deliberate overrides:

```json
{
  "frontierProvider": "claude",
  "memory": { "brainRootDir": "~/_GD/brain" }
}
```

Dead keys from the pre-2026-07-11 local stack (`qwen`, `localModel`,
`localEngine`) are stripped automatically on load — see
`src/lib/config/migrate.ts`.

## 2. Model access — the `claude` CLI (required)

HiveMatrix is Claude-native: every text role runs through the `claude` CLI on the
operator's Claude subscription (OAuth). **No API key, no SDK, and no local model
server** — the Qwen / LM Studio plane was removed in 0.1.176.

1. Install [Claude Code](https://claude.com/claude-code) and sign in (`claude`).
2. Optional: install the `codex` CLI and `codex login` if you want ChatGPT/Codex
   as an alternate frontier provider (`"frontierProvider": "codex"`).
3. Verify: `curl -s http://127.0.0.1:3747/onboarding` shows the **frontier** step
   `done` with the detected CLI path.

Role → model mapping and overrides: [docs/MODEL-ROUTING.md](docs/MODEL-ROUTING.md).

## 3. Background daemon — launchd (required)

```bash
NODE=$(command -v node); DIR=$PWD; LOG="$HOME/Library/Logs/HiveMatrix"; mkdir -p "$LOG"
sed -e "s#{{NODE_PATH}}#$NODE#g" -e "s#{{HIVEMATRIX_DIR}}#$DIR#g" -e "s#{{HIVEMATRIX_LOG}}#$LOG#g" \
  scripts/launchd/com.hivematrix.daemon.plist.template > ~/Library/LaunchAgents/com.hivematrix.daemon.plist
launchctl load -w ~/Library/LaunchAgents/com.hivematrix.daemon.plist
curl -s http://127.0.0.1:3747/health
```

Logs (timestamped): `~/Library/Logs/HiveMatrix/daemon.{out,err}.log`.

## 4. Brain memory plane (required)

Point `config.brainRootDir` at your brain directory (default `~/_GD/brain`) and
ensure it exists. The daemon reads brain docs **asynchronously with a timeout**,
so a cloud-backed root (e.g. Google Drive) can't stall it.

## 5. Alternate model provider (optional)

Model access is **keyless by policy**: inference goes through a subscription CLI,
never an API key. Step 2 covers the required `claude` CLI; installing the `codex`
CLI in addition makes ChatGPT/Codex selectable per role in Settings → Models.
There is no local-inference fallback — with no frontier CLI reachable, text roles
resolve to `unavailable` and work queues (see
[docs/MODEL-ROUTING.md](docs/MODEL-ROUTING.md)).

## 6. Desktop Lane — desktop control (optional)

1. Build the helper bundle: `cd desktopbee-helper && bash build-app.sh` →
   Desktop Lane helper compatibility bundle: `DesktopBeeHelper.app` (signed,
   stable TCC identity).
2. Install its launchd agent (render
   `desktopbee-helper/launchd/com.hivematrix.desktopbee.helper.plist.template`).
3. **Grant permissions** (one-time) in **System Settings ▸ Privacy & Security**:
   - **Accessibility** → enable **Desktop Lane Helper**
   - **Screen & System Audio Recording** → enable **Desktop Lane Helper**

   A launchd-supervised helper can't show the interactive prompt, so add the
   `.app` via the **＋** (point at `…/desktopbee-helper/DesktopBeeHelper.app`).
   Grants attach to the bundle id and persist across rebuilds.
4. Prove it: `npx tsx scripts/desktopbee-proof.mts` (AX query/act + capture,
   approval-gated).

AppleScript/Automation (`script.run`) needs a *separate* per-app Automation
grant; the AX-semantic strategy (preferred) needs neither Automation nor vision.

## 7. Updates (optional)

Wire `config.updater` to a release channel — see
[docs/UPDATE-CHANNEL.md](docs/UPDATE-CHANNEL.md). Verify with
`GET /update/check`.

## Verify

```bash
curl -s http://127.0.0.1:3747/onboarding | python3 -m json.tool
```

`requiredComplete: true` means the system is ready to run directives.
