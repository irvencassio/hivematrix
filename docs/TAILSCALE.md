# Tailscale + HiveMatrix remote access

How the fleet reaches the daemon, and where Tailscale fits.

## The approach

| Device | Path | Why |
|--------|------|-----|
| **iPhone / glasses** | **Tailscale** (`100.x` / MagicDNS) | Private mesh, low latency, **direct P2P voice — no TURN**. Nothing exposed to the internet. |
| **Apple Watch** | **Named Cloudflare tunnel** (`hivey.cassio.io`) | A cellular Watch can only do plain HTTPS — no VPN/mesh, no WebRTC. A public HTTPS endpoint is mandatory. |
| **Anything off-mesh** | Named tunnel | Same token pairing, turn-based voice. |

Cloudflare stays the backbone (required for the Watch). Tailscale is added to
optimize the phone leg. Cloudflare Realtime **TURN stays configured** as the
off-mesh fallback.

## One-time setup (operator)

Tailscale requires an account sign-in (browser auth) — that part is yours.
**Tailnet HTTPS certs must be enabled** (admin console → DNS → Enable HTTPS) —
this is the single most common reason the console's Tailscale toggle fails to
turn on.

```bash
# Install (Homebrew CLI + daemon, or the macOS app from tailscale.com/download)
brew install tailscale && sudo brew services start tailscale
tailscale up
```

Once signed in, the console's **Tailscale toggle** (Settings → Remote access)
runs `tailscale serve --bg 3747` for you and shows a pairing QR — no manual
step needed. (`scripts/tailscale-setup.sh` does the same thing standalone, for
scripted/headless bring-up.)

The daemon binds loopback (`127.0.0.1:3747`) by design; `tailscale serve` proxies
the tailnet to it, so **no daemon bind change and no new public exposure**.

Install Tailscale on the iPhone too (same account), then in HiveMatrix on
iPhone scan the pairing QR — or paste the tailnet URL (`https://<magicdns>`)
and token manually.

## What the daemon does (tailnet-aware)

- **`GET /tunnel`** returns a `tailscale` object:
  `{ installed, running, serving, enabled, ipv4, magicDNSName, pairingUrl }` so
  the app/console can show mesh state, whether `tailscale serve` is actively
  proxying our port, and offer the tailnet pairing URL. `enabled` is the
  toggle's persisted state; `serving` is live-checked via
  `tailscale serve status --json`.
- **`GET /voice/rtc/config`** serves **STUN-only** ICE (skips TURN) when the
  client is on-mesh — detected with zero subprocess cost from an explicit
  `?transport=direct` opt-in or a tailnet `Host` header (`100.x` / `*.ts.net`).
  Off-mesh requests keep the full STUN+TURN set. The response includes
  `transport: "direct" | "relay"`.

Implementation: `src/lib/tunnel/tailscale.ts` (+ `tailscale.test.ts`). Design:
`docs/superpowers/specs/2026-07-05-daemon-tailscale-awareness-design.md`.

> These daemon routes ship in the next desktop-app build; the setup script works
> against the running daemon today.
