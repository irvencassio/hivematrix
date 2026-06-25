# HiveMatrix Appliance Bring-Up Checklist

Stand up a HiveMatrix appliance and get it dogfood-ready. Work top to bottom;
each section gates the next. Items marked **(live)** require the physical Mac.

## 0. Prerequisites
- [ ] Reference Mac: M-series, 128 GB unified memory, recent macOS. **(live)**
- [ ] Accounts on hand: the founder's phone number (iMessage), an email account, optional Telegram bot token, optional Codex/Anthropic auth for frontier, optional content/image endpoint + key.
- [ ] Decide run posture: **100% local** (private/offline), **mixed** (frontier thinking + local execution), or **frontier-only**.

## 1. Install & first run
- [ ] Install the notarized DMG (build ≥ 0.1.1 so auto-update works; ≤ 0.1.0 must be installed manually once). **(live)**
- [ ] Complete the first-run wizard. Confirm the daemon is supervised by launchd (`RunAtLoad` + `KeepAlive`).
- [ ] `GET /health` returns `status: ok` with a version and `license` state.

## 2. Permissions (TCC)  **(live)**
- [ ] **Full Disk Access** for the daemon — required to read `~/Library/Messages/chat.db` (Message Lane).
- [ ] **Automation → Mail** — required for Mail Lane read/draft via AppleScript.
- [ ] **Accessibility** + **Screen Recording** — required for Desktop Lane (AX + capture/vision plane).
- [ ] **Notifications** — for the desktop console and mobile pairing.

## 3. Local model lifecycle (local / mixed posture)  **(live)**
- [ ] Install the serving stack (`mlx_lm.server` preferred, or `lms`/LM Studio).
- [ ] In the wizard's local-model step, pin Qwen3.6-27B 8-bit, 128K context.
- [ ] Confirm `GET /local-model/status` shows the supervisor owns the server (launch → probe → relaunch-on-crash).

## 4. Channels (top priority — the control surface)
- [ ] **Message Lane**: enable the imessage channel; add the founder's handle to the allowlist (`/messagebee/enable`, `/messagebee/identities`). Test-send to the phone. **(live)**
- [ ] **Mail Lane**: enable email; set `mailbee.trustedDomains`; choose draft-for-approval (default) vs auto-send for trusted. **(live)**
- [ ] **Telegram** (optional): set the bot token + hard allowlist; `/notify/test` round-trips a button tap.
- [ ] **notify plane**: configure targets (`/notify/config`) so stuck tasks / approvals escalate to the phone.

## 5. Mobile pairing
- [ ] Open the desktop console pairing QR (`/tunnel/qr`); scan it in the iOS app (`~/hivematrix-ios`) to load URL + token. **(needs an Xcode build of the iOS app)**
- [ ] Confirm the **Approvals** tab lists pending gates and resolves them (approve/deny, stuck retry/skip/abort).
- [ ] (Android `~/hivematrix-android` is a scaffold — build in Android Studio later.)

## 6. Connectivity / remote access
- [ ] Bring up the **named Cloudflare tunnel** (durable/multi-user), not a quick trycloudflare (test-only).
- [ ] `GET /posture` shows each capability as works/degraded/queued for the chosen posture — no silent failures.

## 7. Capability config (optional per posture)
- [ ] **Content** (W5.2): set `config.content.{endpoint,model,apiKeyEnv}` for rendition generation (degrades honestly if absent).
- [ ] **Image** (W5.1): nanai endpoint/key for cloud, or install the `mflux` CLI for local.
- [ ] **Browser Lane**: Codex Computer Use auth for the frontier backend, or enable the Desktop Lane fallback for local-only.

## 8. Licensing (W7.3)
- [ ] Install the signed license (`POST /license`) and set the issuer public key (`config.license.publicKeyPem` or `HIVEMATRIX_LICENSE_PUBKEY`).
- [ ] `GET /license/status` shows `valid` (or `missing`/`unlicensed` while pre-issuance — these never block the box).

## 9. Telemetry (W7.2)
- [ ] Leave telemetry **OFF** (default) unless you want local diagnostics; if on, it stays local-only.
- [ ] Sanity-check `GET /diagnostics/bundle` returns operational signal (for "send diagnostics").

## 10. First directives
- [ ] **Email triage** directive (Mail Lane → triage tasks).
- [ ] **Daily LinkedIn ritual** (`POST /linkedin/ritual`) — plan-checkpointed, approve-by-text.
- [ ] **Morning brief** directive — what shipped / what's stuck / what needs you.
- [ ] Run a content brief (`POST /content/brief`) end-to-end: brief → renditions → approve by text.

## 11. Resilience drills (W7.4)  **(live)**
- [ ] Drill 1 — `pkill -9` the daemon mid-directive → it resumes from `run_journal`, no duplicate work.
- [ ] Drill 2 — reboot → `GET /health` ok and scheduler `running` within ~5 minutes, no human action.
- [ ] Drill 3 — offline cold start → usable in local-only immediately after reboot.

## 12. Dogfood-week readiness
- [ ] One full week target: email watched, content posted, LinkedIn engaged, code shipped, SMS as the control surface — founder touches only approvals.
- [ ] Capture the week's artifact trail (tasks, approvals, renditions, traces) — it becomes the sales demo.
