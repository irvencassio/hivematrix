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

```bash
# Install (Homebrew CLI + daemon, or the macOS app from tailscale.com/download)
brew install tailscale && sudo brew services start tailscale

# Drive the rest — sign-in, `tailscale serve`, and print the pairing URL + token:
cd ~/hivematrix && ./scripts/tailscale-setup.sh
```

The daemon binds loopback (`127.0.0.1:3747`) by design; `tailscale serve` proxies
the tailnet to it, so **no daemon bind change and no new public exposure**.

Install Tailscale on the iPhone too (same account), then in the HiveMatrix iOS
app paste the tailnet URL (`https://<magicdns>` or `http://100.x.y.z:3747`) + the
token — or scan a QR built from them.

## What the daemon does (tailnet-aware)

- **`GET /tunnel`** returns a `tailscale` object:
  `{ installed, running, ipv4, magicDNSName, pairingUrl }` so the app/console can
  show mesh state and offer the tailnet pairing URL.
- **`GET /voice/rtc/config`** serves **STUN-only** ICE (skips TURN) when the
  client is on-mesh — detected with zero subprocess cost from an explicit
  `?transport=direct` opt-in or a tailnet `Host` header (`100.x` / `*.ts.net`).
  Off-mesh requests keep the full STUN+TURN set. The response includes
  `transport: "direct" | "relay"`.

Implementation: `src/lib/tunnel/tailscale.ts` (+ `tailscale.test.ts`). Design:
`docs/superpowers/specs/2026-07-05-daemon-tailscale-awareness-design.md`.

> These daemon routes ship in the next desktop-app build; the setup script works
> against the running daemon today.
