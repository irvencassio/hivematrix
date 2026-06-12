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

## Q7 — Cloud-only run mode + Bee lanes for the local agent

Date closed: 2026-06-12.

**Decision A — Cloud-only posture.** Alongside `Local` (pure Qwen) and `Mixed`
(router: frontier thinking + local processing), a third selectable macro mode
**Cloud-only** runs every role on frontier and never spawns the local model.
When the cloud is unreachable a cloud-only task is **not** downgraded to local —
it is left for retry when `cloud-ok` returns (no silent local fallback). This is
a router preference (`routeByRole(role, policy, { noLocal })`), surfaced as the
`cloud-only` model option; setting it as the default model also makes directive
"execute" work stay on frontier.
**Code:** `src/lib/routing/router.ts` (`RouteOptions.noLocal`),
`src/lib/models/available.ts` (`CLOUD_ONLY_ID`), `src/lib/orchestrator/subprocess.ts`
(`model === "cloud-only"` branch), `src/lib/orchestrator/directive-engine.ts`.

**Decision B — Bee lanes available to the local (Qwen) agent.** The three
existing embedded lanes — WebBee, BrowserBee, DesktopBee — are exposed to the
local/generic agent tool loop as function tools (`webbee_search`,
`browserbee_run`, `desktopbee_action`). No new brands. Each is gated by the
ConnectivityPolicy capability matrix: a lane disabled in the current mode is
neither advertised to the model nor dispatched. BrowserBee jobs run as delegated
Codex Computer Use tasks. DesktopBee acts are auto-approved at dispatch (Irv's
explicit posture), with the Swift helper's server-side gate retained as
defence-in-depth.
**Code:** `src/lib/orchestrator/bee-tools.ts`, wired via
`src/lib/orchestrator/tool-bridge.ts` and `generic-agent.ts`.
**Provers:** `src/lib/orchestrator/bee-tools.test.ts`,
`src/lib/routing/router.test.ts` (noLocal cases),
`src/lib/models/available.test.ts` (cloud-only cases).

---

## Q8 — MessageBee un-deferred (SMS/iMessage channel lane)

Date closed: 2026-06-12.

**Decision.** MessageBee moves from "deferred beyond notification egress" to an
**active embedded channel lane** — the top channel priority for the autonomous
business operator, because SMS/iMessage is the founder's control surface
(approvals, `needs_input` replies, content sign-off by text). No standalone
runtime and no new HTTP brand service: it runs **inside the daemon**, like the
WebBee/BrowserBee/DesktopBee lanes (Q7-B pattern).

**Mechanism (self-contained — no external `imessage` CLI).**
- **Read:** poll `~/Library/Messages/chat.db` directly via better-sqlite3
  (read-only), high-water-marked by `message.ROWID`. Requires the daemon to hold
  **Full Disk Access** (a new optional onboarding step + System Settings
  deep-link, mirroring the DesktopBee TCC pattern).
- **Send:** `osascript` AppleScript `tell application "Messages" … send` (built
  into macOS; recipient + text passed as `on run` argv to avoid escaping).
- **Routing:** inbound from an **allowlisted** identity (`message_identities`)
  → resolve a pending `needs_input` task for that sender and post the reply, else
  create a task (`source: "messagebee"`). Non-allowlisted senders are read-only
  (never create or resolve work). `/model` directives parsed (ported pattern).
- **State:** the existing `message_channels` / `message_identities` tables (db
  v5). chat.db schema access is version-gated; the AppleScript send path is
  independent of the read path so a chat.db schema drift can't break sending.

**Code:** `src/lib/messagebee/` (contracts, imessage I/O, store, handoff, poller),
wired into the daemon boot + `src/daemon/server.ts` (`/messagebee/*`) +
onboarding. **Scope wall + COMPONENT-MAP amended** in the same change.
**Provers:** `src/lib/messagebee/*.test.ts` (routing/allowlist/parse/applescript);
end-to-end: SMS in → task → iMessage reply; `needs_input` round-trip; a
non-allowlisted sender cannot trigger execution.

---

## Q9 — MailBee un-deferred (email watch + trust-gated drafting)

Date closed: 2026-06-12.

**Decision.** MailBee becomes an **active embedded channel lane** (the founder's
inbox, watched and triaged). Self-contained via **Apple Mail (osascript)** — no
IMAP/SMTP creds, no OAuth; it reads/sends through accounts Mail.app already holds
(Gmail + Outlook both work). Same daemon-embedded pattern as MessageBee (Q8).

**The safety story (ported from Hive 1, the highest-value reusable asset).**
Every inbound email is **trust-classified** before anything acts on it
(`classifyMailTrust`): prompt-injection signal detection in subject/body, risky
(executable/script) attachment detection, and trust hints (known sender +
authenticated domain). Levels: `trusted` (known + authenticated domain) /
`external` (default) / `suspicious` (injection or risky attachment). The email
body/thread/links/attachments are treated as **untrusted input**; auto-send is
gated to `trusted` senders; everything else drafts-for-approval.

**Mechanism.** Read recent inbox messages via `osascript` (high-water by Mail
message id), trust-classify, create a task (`source: "mailbee"`) carrying the
trust assessment; the agent drafts a reply; approval (e.g. via MessageBee text,
W1.3) sends it. Allowlist + "trusted domains" live in `message_identities` /
config (channel `email`). State in the v5 `message_channels`/`message_identities`
tables.

**Code:** `src/lib/mailbee/` (contracts incl. `classifyMailTrust`, applemail I/O,
store, handoff, poller). Endpoints `/mailbee/*`; onboarding `mailbee` step.
Scope wall + COMPONENT-MAP amended. **Provers:** `src/lib/mailbee/*.test.ts`
(trust classification + routing); live-Mac: real Mail.app read/draft.

---

Proposals for future phase boundaries go below this line. Nothing above is re-opened without a new decision entry.
