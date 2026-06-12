# Remote Access (Cloudflare Tunnel)

HiveMatrix can expose its daemon API + console to the internet via a Cloudflare
tunnel, so a remote client (e.g. the HiveMatrix-iOS app) can reach it. **This is
off by default** and must be started explicitly in Settings → Remote access.

## How it works

- The daemon binds **loopback only** (`127.0.0.1:3747`). `cloudflared` runs as a
  local child process and proxies a public URL to it.
- **Quick tunnel** (Settings → Start tunnel, or `POST /tunnel/start`):
  `cloudflared tunnel --url http://localhost:3747` → a random
  `https://<words>.trycloudflare.com` URL. No Cloudflare account required.
- Endpoints: `GET /tunnel` (status), `POST /tunnel/start`, `POST /tunnel/stop`.

## Security model (read before exposing)

A tunnel makes the daemon reachable from the internet. The defenses:

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

### Residual risks / hardening

- A quick-tunnel URL is **random but not secret-grade** — anyone who learns it
  can *reach* the daemon (but still needs the token to do anything). Treat the
  token like a password; rotate it by deleting `~/.hivematrix/auth-token` and
  restarting the daemon (clients re-paste).
- `/health` is intentionally public (liveness, no secrets) and is the one route
  exposed unauthenticated over the tunnel.
- The bearer token is a single long-lived secret. There is no per-client
  revocation, rate limiting, or audit of remote calls yet.

### Recommended for production

Use a **named tunnel behind Cloudflare Access** instead of a quick tunnel:

```
cloudflared tunnel login
cloudflared tunnel create hivematrix
# route a hostname, add an Access policy (email OTP / SSO / service token)
cloudflared tunnel run --url http://localhost:3747 hivematrix
```

Cloudflare Access then enforces identity at the edge *before* traffic reaches
the daemon, so the bearer token is a second factor rather than the only one.
A service token works well for the iOS app.

## Token rotation

1. Stop the tunnel.
2. `rm ~/.hivematrix/auth-token` and restart the daemon (it regenerates one).
3. Re-copy the new token from Settings → Remote access into each client.
