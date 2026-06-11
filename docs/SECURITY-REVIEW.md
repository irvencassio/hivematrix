# Security Review — 2026-06-11

Final review pass over the security-sensitive surfaces (token handling, the
daemon + helper HTTP surfaces, the AppleScript allowlist). Findings are reported
for decision; risky/design-level changes were **not** auto-applied. One
clearly-safe hardening (F5) was applied.

Context that bounds severity: single-user, single-Mac appliance; both HTTP
surfaces bind **loopback only** (not network-reachable).

---

## F1 — Daemon HTTP API is unauthenticated with wildcard CORS  · HIGH

`src/daemon/server.ts` sets `Access-Control-Allow-Origin: *` and has no auth.
Loopback bind keeps it off the network, but the wildcard CORS means **any web
page the user visits** can issue cross-origin requests to
`http://127.0.0.1:3747` from their browser — creating/cancelling tasks, creating
directives, and flipping connectivity mode (a CSRF-style drive-by).

Recommendation (needs a console-compat decision, so not auto-applied):
- Replace `*` with the specific console origin, and/or require a local session
  token (write `~/.hivematrix/session-token` mode 600; console + Tauri read it,
  daemon checks it), and/or validate the `Origin` header on mutating routes.

## F2 — DesktopBee helper API is unauthenticated  · HIGH

`desktopbee-helper` binds loopback only (good) but has **no caller
authentication**. Any local process can POST `desktop.*` — including `type` /
`click` / `ax.act` (drive the desktop) and `script.run`. The approval tiers are
enforced **client-side** (`src/lib/desktopbee/client.ts`), so a different local
process bypasses approval entirely by calling the helper directly.

Recommendation (design change, not auto-applied):
- Shared secret between daemon and helper (a token minted at launch, passed in a
  header and checked by the helper), or a UDS with peer-credential/pid checks.

## F3 — `script.run` allows arbitrary shell via AppleScript `do shell script`  · HIGH

The app allowlist (`SCRIPT_APP_ALLOWLIST`) gates the **target app name**, but the
**script body is arbitrary AppleScript**, and AppleScript's `do shell script`
runs arbitrary shell commands irrespective of the target app. So an allowlisted
`Finder` `script.run` is effectively arbitrary code execution.

Mitigations present: `script.run` is the **approval** tier (never auto-approved
unless `autoApproveScripts` is explicitly set). Combined with F2, though, a
direct helper caller skips that gate.

Recommendation (not auto-applied — needs a policy call):
- Keep `script.run` always-approval (never expose `autoApproveScripts` in
  production); consider rejecting scripts containing `do shell script` at the
  helper, or running them via a reduced-privilege path; fix F2 so only the
  daemon can reach the helper.

## F4 — "System Events" in the default script allowlist is very broad  · MEDIUM

`SCRIPT_APP_ALLOWLIST` defaults to `Finder, System Events`. **System Events** can
UI-script any application and synthesize input system-wide, so allowlisting it is
close to allowlisting everything.

Recommendation (default change — reported, not auto-applied to avoid surprising
existing setups): drop `System Events` from the default; require explicit opt-in
via `DESKTOPBEE_SCRIPT_ALLOWLIST`.

## F5 — Updater attached auth to any channel URL scheme  · LOW · FIXED

`getUpdaterConfig()` built the `Authorization: Bearer <token>` header without
checking the URL scheme; a misconfigured `channelUrl` (http / wrong host) would
have leaked the token in cleartext.

**Fixed:** the token is now attached only when `channelUrl` is `https://`.
(Current config uses `https://api.github.com/...`, so no behavior change.) A
host allowlist would harden this further.

## F6 — Broad `gh` token stored on disk  · LOW · operational

`~/.hivematrix/keys/github-token` (mode 600) currently holds the local `gh`
CLI token (broad scope) for the private update channel demo. Documented in
[UPDATE-CHANNEL.md](UPDATE-CHANNEL.md): replace with a **fine-grained
Contents:Read PAT** scoped to `irvencassio/hivematrix` for any unattended
deployment.

## F7 — Hand-rolled HTTP/1.1 parser in the helper  · INFO

The helper parses HTTP requests with a minimal custom parser. Loopback-only bind
bounds exposure; malformed requests are low risk here but the parser is not
hardened against adversarial input. Acceptable given the threat model; revisit
if the helper is ever exposed beyond loopback.

---

### Disposition

- **Applied now:** F5 (HTTPS-only token attach).
- **Recommend before any multi-process / less-trusted-software scenario:** F2 +
  F3 (helper auth + script.run hardening) — these are the highest-leverage.
- **Recommend soon:** F1 (CORS/auth) if the console is ever opened in a normal
  browser tab; F6 (fine-grained PAT).
- **Optional default tightening:** F4.
