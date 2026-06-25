# HiveMatrix Onboarding

First-run provisioning for a single-Mac install. The daemon exposes a live
readiness checklist at `GET /onboarding` (also shown as the "Setup" strip in the
console); this document is the human walkthrough for each step.

Required steps gate a green first run; optional steps unlock extra capability.

## 1. Configuration file (required)

Create `~/.hivematrix/config.json`. Minimal local-only config:

```json
{
  "localModel": { "provider": "lmstudio", "endpoint": "http://localhost:1234/v1", "modelName": "qwen/qwen3.6-27b" },
  "qwen": {
    "location": "local",
    "primary": { "modelId": "qwen/qwen3.6-27b", "endpoint": "http://localhost:1234/v1", "provider": "lmstudio", "contextLimit": 65536 },
    "thinkingEnabled": true, "minDecodeRate": 15, "probeTimeoutMs": 120000
  }
}
```

## 2. Local model — Qwen via LM Studio (required)

1. Install [LM Studio](https://lmstudio.ai); download **Qwen 3.6 27B (MLX 8-bit)**.
2. Load it with no TTL so it stays resident:
   `lms load qwen/qwen3.6-27b --context-length 65536 --gpu max -y` (its API
   server runs on `:1234`; `autoStartOnLaunch` + a Login Item keep it up).
3. Verify the readiness gate: `npx tsx scripts/qwen-readiness.mts` (6 checks:
   model listing, streaming, single tool call, multi-step tool chain,
   reasoning/think separation, decode rate ≥ floor) + the standing eval suite.

See [QWEN-LOCAL-PROFILE.md](QWEN-LOCAL-PROFILE.md) for model/quant rationale.

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

## 5. Frontier model access (optional)

For `cloud-ok` mode, provide a Claude/OpenAI key (`ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`, or `config.providers.openai`). Without it HiveMatrix runs
**local-only** on Qwen — fully functional, just no frontier tier.

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
   approval-gated, Qwen-planned).

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
