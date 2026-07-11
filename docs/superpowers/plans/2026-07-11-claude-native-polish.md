# Claude-Native Polish — final UI cleanup + 2 deferred features

**Date:** 2026-07-11 · **Status:** Approved design — Sonnet executes phase by phase
**Context:** Post-cutover (HiveMatrix is Claude-native since 0.1.176). This spec finishes
the settings polish the operator flagged while walking the app, plus the two deferred
features (Cloudflare pairing QR, Flash `--resume`).

Constraints (ALL phases): no `ANTHROPIC_API_KEY` / `@anthropic-ai` SDK; console client JS
is inside a `String.raw` template — `+` concatenation only, NO backticks/`${}`; the
template must still parse (tsc catches via the `CONSOLE_HTML` export); match surrounding
style; delete/adjust tests for changed behavior.

---

## Phase 1 — Observability: stop showing retired local models

The Observability panel (sidebar + full dashboard) still surfaces historical local rows —
"Local (retired)" (deepseek-v4-flash), "Local model" (qwen3.6-*), a green "65 local" count
pill, and a **wrong** "Suggested routing: developer → Local model". These are historical
telemetry rows; the operator does not want to see the retired engines and definitely not a
suggestion to route to one.

- **Filter retired-local rows out of the live view.** In the observability aggregation
  (`src/lib/observability/contracts.ts` — `split: { local, frontier }` at ~:347, and the
  provider/model grouping) and the console renderer (`src/daemon/console.ts` obs panel ~:2900-2990),
  exclude rows whose provider classifies to the retired local buckets
  (`local-qwen`, `local-dwarfstar`, and anything matching the old local/qwen/deepseek/mlx
  classifier). Keep only `anthropic` (Claude) and `openai-codex` (Codex). Historical rows
  stay in the DB — this is a **display filter**, not a delete.
- **Drop the "N local" count pill** (keep "N frontier" / total-tokens). Post-cutover every
  live run is frontier.
- **Fix "Suggested routing".** The route scorecard suggestion (`console.ts:2969` region) must
  never suggest a retired local route. Either compute suggestions only over Claude/Codex
  routes, or remove the "developer → Local model" style suggestion entirely if it can only
  come from historical local data. Verify no suggestion names a local model.
- **Verify:** open the obs panel (sidebar + full dashboard) against the live daemon
  (`/observability*` on :3747 with the token in `~/.hivematrix/auth-token`) at 1h/24h/7d/30d
  — no "Local", "Local (retired)", "qwen", "deepseek" rows/labels; suggested routing names
  only Claude tiers; totals still reconcile (the 1h bucket fix from the prior pass must hold).

## Phase 2 — Header: remove the `cloud-ok` pill, keep `● live`

The header shows both a `● live` daemon indicator (`console.ts:989`, updated by the SSE
`onopen`/`onerror` at ~:9145) and a separate `cloud-ok` connectivity pill (CSS `.pill.cloud-ok`
:163). They're redundant to the operator.

- Remove the header **connectivity pill** (`cloud-ok`/`local-only`/`offline` pill) and its
  render/update code from the header. Keep the `● live` indicator.
- If connectivity still matters (offline = Claude unreachable = nothing works), fold it into
  the `live` indicator's state: `● live` (green) when the daemon is up AND connectivity is
  cloud-ok; degrade its color + tooltip (e.g. "offline — Claude unreachable") when offline,
  instead of a second pill. Do NOT remove the underlying connectivity policy/state — only the
  redundant header pill. Leave the Settings connectivity-mode control (the `<select>` at ~:1003)
  as-is unless it also duplicates.
- **Verify:** header shows a single status indicator; toggling connectivity state updates it.

## Phase 3 — Providers: remove On/Off toggles → "installed / install"

The PROVIDERS section has Claude/Codex On-Off toggles (`console.ts` provider-toggle rows).
`isProviderEnabled` (`src/lib/config/frontier-providers.ts:64`) already **defaults to
`binaryDetected`** when no explicit `enabled` key is set — so enablement can be purely
"is the CLI installed?" with no toggle.

- **Remove the provider On/Off toggle UI.** Replace the PROVIDERS section with status derived
  from the BACKENDS cards: for each frontier CLI (Claude Code, Codex) show installed ✓ + path,
  or "not set up" with an **Install** affordance (a button/link that runs the existing provider
  setup — reuse `runProviderSetup`/the onboarding install path if present; otherwise link to
  install docs). No enable/disable switch.
- **Enablement = detected.** Stop writing `providers.<id>.enabled` from the UI. Leave
  `isProviderEnabled`'s detected-default behavior; if any stale explicit `enabled:false` exists
  in config it should no longer be set by the UI (optional: the migrate step can drop
  `providers.<id>.enabled` keys — low priority, note only).
- Codex is **not removed** — it remains an installable alternate frontier/fallback; it just has
  no toggle. Keep the FRONTIER PROVIDER picker only meaningful when both CLIs are installed
  (if only Claude, hide/disable the picker).
- **Verify:** with only Claude installed, PROVIDERS shows Claude ✓ and a Codex "Install"
  affordance, no toggles; routing still works (Claude auto-enabled via detection).

## Phase 4 — Cloudflare pairing QR (daemon side)

Today `/tunnel/qr` (`src/daemon/server.ts` ~:1376) is **Tailscale-only** — it encodes
`pairingPayload(ts.pairingUrl, token)` and refuses unless Tailscale is serving. The
`pairingPayload` type ALREADY supports optional Cloudflare Access creds
(`src/lib/tunnel/cloudflared.ts:31-45`: `cloudflareAccessClientId/Secret` →
`cloudflareAccess:{clientId,clientSecret}`), and `generateQrSvg` (cloudflared.ts) renders via
local `qrencode`. So a Cloudflare QR is a small addition — the iOS side (scanning) is handled
by the parallel `hivematrix-ios` session.

- **New endpoint `GET /tunnel/qr/cloudflare`** (mirror `/tunnel/qr`, same Pro-license/
  `companion_pairing` gate): build the payload from the Cloudflare named-tunnel config —
  `pairingPayload(<public https hostname>, AUTH_TOKEN, { cloudflareAccessClientId, cloudflareAccessClientSecret })`
  read from the saved tunnel settings (`cloudflared.ts` `getCloudflareStatus`/settings ~:103-135).
  Return the SVG via `generateQrSvg`. 400 if the named tunnel/hostname isn't configured; do not
  emit a QR missing the Access creds when Access is configured (that QR wouldn't authenticate).
- **Console:** add a **QR slot in the Cloudflare card** (the Remote tab Cloudflare/Watch card),
  fetched from `/tunnel/qr/cloudflare`, shown once hostname (+ Access, if used) is saved — so the
  phone/watch can scan hostname+token(+Access) instead of hand-typing three fields. Label it
  clearly ("Scan on iPhone"), with the security note that it encodes the token + Access secret
  (password-equivalent), mirroring the existing manual-token warning.
- Scope: **daemon side only.** Do not touch `hivematrix-ios`.
- **Verify:** with a Cloudflare hostname (+ optional Access creds) configured, the endpoint
  returns a valid SVG whose decoded payload is `{type:"hivematrix-connection", url:<https host>,
  token, cloudflareAccess?}`; 400 when unconfigured. Unit-test `pairingPayload` with Cloudflare
  fields (already partly covered — extend).

## Phase 5 — Flash `--resume` session continuity

Since the stdin fix, multi-turn no longer crashes (full history is re-serialized each turn),
so this is now a **performance/quality optimization**, not a bug fix: `--resume` lets the CLI
keep the session server-side so we stop re-sending the whole transcript every turn (cheaper,
and drops the "--- Prior conversation ---" block). Stream-json already emits the CLI session id
(`stream-parser.ts`: `{ type: "session", sessionId }` from the `system:init` event).

- **Persist the CLI session id per flash session.** Add a `cliSessionId TEXT` column to
  `flash_sessions` (new DB migration in `src/lib/db/index.ts`, follow the existing migration
  pattern) + store/read helpers in `src/lib/flash/store.ts`.
- **loop.ts:** on each turn, if a `cliSessionId` is stored for this flash `sessionId`, pass
  `--resume <cliSessionId>` and send ONLY the new user message via stdin (no transcript block —
  `buildFlashPrompt` should serialize just the latest user turn when resuming). Capture the
  `session` stream event and persist its `sessionId` for next time (it may change per run —
  store the latest). On the FIRST turn (no stored id) keep the current full-serialization path.
- **Fallbacks:** if `--resume` fails (session expired / daemon restarted / CLI error mentioning
  the session), retry once WITHOUT `--resume` using full-history serialization, and clear the
  stored id. Never let a stale id break a turn.
- Keep `MAX_TOOL_CALLS`/`MAX_WALL_MS`, the MCP tool wiring, and the stdin prompt delivery
  unchanged.
- **Verify:** a 3-message live conversation streams correctly and (via logs/`ps`) the 2nd/3rd
  turns pass `--resume` with a short prompt; killing/clearing the stored id falls back cleanly.
  Existing flash tests pass; add a `buildFlashPrompt(resume=true)` unit test (only latest user
  msg) and a store round-trip test.

---

## Execution order & risk
1–3 are console/settings + observability/frontier-providers (low risk, mostly display). 4 is a
self-contained new endpoint + card. 5 touches the DB schema + the flash loop (higher care;
isolated to flash + a migration). Recommend two Sonnet passes: **Pass A = Phases 1-3**
(one console-heavy pass, avoids self-conflict), **Pass B = Phases 4-5** (features). Verify +
commit each phase; deploy once all green. Do NOT introduce API keys anywhere.
