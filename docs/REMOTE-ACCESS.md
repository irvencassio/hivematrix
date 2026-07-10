# Remote Access (Tailscale + Cloudflare Tunnel)

HiveMatrix reaches your phone through two independent toggles in Settings →
Remote access, each driving a real transport:

| Toggle | For | What it does when on |
|---|---|---|
| **Tailscale** | iPhone | Runs `tailscale serve --bg 3747`, proxying the private mesh to the loopback daemon. Shows a pairing QR. Nothing is exposed to the internet. |
| **Cloudflare** | Apple Watch | Runs (or adopts) a **permanent named** `cloudflared` tunnel. No QR — the Watch is paired manually from HiveMatrix on iPhone. |

**Both are off by default.** Turning a toggle on starts (or adopts) the
transport immediately; turning it off stops only what HiveMatrix itself
started — an externally-run Cloudflare connector is never killed.

There is no temporary/quick tunnel. HiveMatrix used to offer a throwaway
`*.trycloudflare.com` tunnel (`POST /tunnel/start`); it has been removed in
full. Cloudflare access is permanent-tunnel only.

## How it works

- The daemon binds **loopback only** (`127.0.0.1:3747`).
- **Tailscale**: `tailscale serve --bg 3747` proxies the tailnet to the
  loopback daemon over HTTPS on the Mac's MagicDNS name. Requires tailnet
  HTTPS certs enabled (Tailscale admin console → DNS → Enable HTTPS) — this is
  the most common reason the toggle fails to turn on.
- **Cloudflare**: a *named* tunnel, `cloudflared tunnel run --token
  <connectorToken>`, hostname configured in the Cloudflare dashboard. HiveMatrix
  can run the connector itself, or just adopt one already running externally
  (Settings → Remote access → save the hostname with no connector token).
- Endpoints: `GET /tunnel` (combined status, includes a nested `tailscale`
  object), `POST /remote/tailscale/enabled`, `POST /remote/cloudflare/enabled`,
  `POST /tunnel/configure-named`, `POST /tunnel/access-credentials`,
  `POST /tunnel/stop`, `GET /tunnel/qr` (Tailscale pairing QR).

## Security model (read before exposing)

A Cloudflare tunnel makes the daemon reachable from the internet. Tailscale
does not — it stays on your private mesh. The defenses for the Cloudflare leg:

1. **Bearer-token auth** on every route except `/health`, `/`, `/console`. The
   token lives in `~/.hivematrix/auth-token` (mode 600). Remote clients must
   send `Authorization: Bearer <token>`; unauthenticated requests get 401.
   *(Verified: `/metrics` over the tunnel → 401 without the token, 200 with it.)*
2. **The token is never served to tunneled visitors.** The console injects the
   token into its HTML only for **direct loopback** requests. Requests arriving
   via Cloudflare carry a `CF-Connecting-IP` header; for those the console is
   served with an **empty** token and prompts the visitor to paste it (obtained
   from the local Settings → Remote access → Access token). This closes the
   "anyone with the tunnel URL gets the token" hole.
   *(Verified: tunneled `/console` ships an empty token.)*
3. **The Tailscale pairing QR never includes the Cloudflare Access secret.**
   The mesh needs none of it, so `GET /tunnel/qr` builds its payload with no
   `cloudflareAccess` field — one fewer place that secret can leak.

### Residual risks / hardening

- `/health` is intentionally public (liveness, no secrets) and is the one route
  exposed unauthenticated over the tunnel.
- The bearer token is a single long-lived secret. There is no per-client
  revocation, rate limiting, or audit of remote calls yet.
- **Protect the Cloudflare hostname with Cloudflare Access** (a service token,
  configured in Settings → Remote access → Cloudflare). Access enforces
  identity at the edge *before* traffic reaches the daemon, so the bearer
  token becomes a second factor rather than the only one. The Watch app
  presents the service-token credentials on every request.
- `tailscale serve reset` (what turning the Tailscale toggle off runs) clears
  the node's **entire** serve config, not just HiveMatrix's handler — a
  concern only if this Mac serves something else via `tailscale serve` too.

## Token rotation

1. Turn off both toggles (or at minimum stop Cloudflare).
2. `rm ~/.hivematrix/auth-token` and restart the daemon (it regenerates one).
3. Re-copy the new token from Settings → Remote access into each client.
