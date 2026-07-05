# Daemon Tailscale Awareness — Design

Date: 2026-07-05
Status: Design (approved to implement — operator requested "add daemon awareness")

## Purpose

Bring the HiveMatrix daemon "up to date with the Tailscale approach" from the
brain doc `~/_GD/brain/.../2026-06-12-hivematrix-cloudflare-tunnels.html`:
keep the named Cloudflare tunnel as the backbone (mandatory for the Apple
Watch), and add **Tailscale** as the private, low-latency path for the phone —
direct P2P voice with **no TURN relay** when on-mesh.

The iOS app already: connects over a tailnet URL, presents Tailscale as the
recommended phone path, and dropped the temporary tunnel. This spec covers the
**daemon** side.

## Current state (verified 2026-07-05)

- Named tunnel `hivey.cassio.io` running (`GET /tunnel` → `mode: named`), Access
  configured. ✅ backbone is solid.
- Daemon binds **loopback only** (`127.0.0.1:3747`) — a tailnet peer reaches it
  via `tailscale serve`, not a bind change.
- **Tailscale is not installed** on the Mac; the daemon has **no Tailscale code**.
- The running daemon is the packaged app, so daemon source changes here take
  effect on the next desktop-app rebuild. The setup script/runbook works now.

## Scope

1. **Tailnet detection module** `src/lib/tunnel/tailscale.ts` — shell out to the
   `tailscale` CLI for status; pure parsers for testing.
2. **`GET /tunnel`** — add a `tailscale` object so the console/app can show mesh
   state and a tailnet pairing URL.
3. **`GET /voice/rtc/config`** — return **STUN-only** (skip TURN) when the client
   is on-mesh, so live voice goes direct. Relay stays the default/fallback.
4. **Operator runbook** — `scripts/tailscale-setup.sh` + `docs/TAILSCALE.md`
   (install, `tailscale up`, `tailscale serve 3747`, pairing). The one-time
   install + sign-in is the operator's (browser auth); the script drives the rest.

Non-goals: no bind change (keep loopback + `tailscale serve`); no removal of the
Cloudflare tunnel or TURN (both stay as the Watch/off-mesh fallback); no
auto-install of Tailscale (account sign-in is the operator's).

## Contracts

### `src/lib/tunnel/tailscale.ts`

```ts
interface TailscaleStatus {
  installed: boolean;      // tailscale CLI found
  running: boolean;        // BackendState === "Running"
  ipv4: string | null;     // 100.x tailnet IP
  magicDNSName: string | null;  // Self.DNSName, trailing dot stripped
  pairingUrl: string | null;    // http://<ipv4>:<port>
}
tailscaleStatus(port): TailscaleStatus            // impure (execFileSync, 4s timeout)
parseTailscaleStatusJSON(raw, port)               // pure
isTailnetAddress(ip): boolean                     // 100.64.0.0/10 (CGNAT)
hostOnMesh(hostHeader): boolean                   // host is tailnet IP or *.ts.net
filterStunOnly(iceServers): iceServers            // drop turn:/turns: entries
```

### `GET /tunnel` (additive)

Response gains `tailscale: TailscaleStatus`. Existing fields unchanged.

### `GET /voice/rtc/config` (additive)

- On-mesh detection is **cheap and subprocess-free**: `transport=direct` query
  param OR `hostOnMesh(Host header)` (a tailnet IP or `*.ts.net`).
- On-mesh → `{ iceServers: <stun-only>, transport: "direct" }`.
- Otherwise → `{ iceServers: <stun+turn>, transport: "relay" }` (unchanged shape
  plus the `transport` hint).

## Testing (TDD, colocated `*.test.ts`, `node:test`)

`src/lib/tunnel/tailscale.test.ts`:
- `isTailnetAddress` — 100.64–100.127 true; 100.63/100.128/10.x/garbage false.
- `hostOnMesh` — `100.101.102.103:3747` true, `mac.tailXXXX.ts.net` true,
  `hivey.cassio.io` / loopback false.
- `parseTailscaleStatusJSON` — fixture yields running + ipv4 + magicDNSName +
  pairingUrl; malformed → all-null/not-running.
- `filterStunOnly` — drops turn/turns, keeps stun (string + array urls).

## Verification gates

`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs`. (No
local-model surface touched, so the qwen-readiness gate is not required.)
