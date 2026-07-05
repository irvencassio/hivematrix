# Device Pairing & Remote Connectivity — Cloudflare Alternatives (2026)

Research date: 2026-07-04. Goal: make it **stupid easy** and **super reliable** for
iPhone / Apple Watch (cellular) / glasses to reach Mac-hosted HiveMatrix, including
the voice channel. All external claims verified against primary sources (cited);
unverified items flagged.

## Current setup (repo)

- **WebRTC media NAT traversal — Cloudflare Realtime TURN.** The daemon mints
  short-lived ICE credentials from a TURN Key and hands them to both the iOS client
  (`GET /voice/rtc/config`) and the aiortc server (`HIVE_TURN_*`).
  `src/lib/voice/realtime-session.ts:61-132` (`mintCloudflareIce`, endpoint
  `rtc.live.cloudflare.com/v1/turn/keys/…/credentials/generate-ice-servers`).
  Media flows peer-to-peer; TURN only relays when a direct path fails. **This is
  fine — keep it.**
- **Daemon public exposure — Cloudflare *quick* tunnel (cloudflared).**
  `GET /tunnel`, `POST /tunnel/start` → `src/lib/tunnel/cloudflared.ts`
  (`src/daemon/server.ts:1097-1104`). Auth token is withheld from requests that
  arrive via Cloudflare (`cf-connecting-ip` / `cf-ray` header detection,
  `src/daemon/server.ts:340-347`).
- **Voice pipeline is WebRTC** (SmallWebRTC / aiortc), realtime_server.py; plus a
  **turn-based** HTTPS path `POST /voice/turn` → `runFlashTurnText` described as a
  "thin alias over Flash Lane for watch/glasses clients that expect JSON"
  (`src/lib/flash/index.ts:29-34`, `src/daemon/server.ts:3331-3390`).

**The weak link:** Cloudflare **quick** tunnels are documented testing-only —
random `*.trycloudflare.com` subdomain per launch, **no Server-Sent Events**, and a
200 in-flight-request cap ([CF docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).
`/flash/turn` is SSE, so the quick tunnel **cannot stream Flash responses remotely**,
and the rotating URL breaks "pair once."

## The hard constraint: the Apple Watch (verified against Apple docs)

This drives the entire architecture and rules out the obvious "just use Tailscale":

1. **No VPN/mesh can ever include the Watch.** Apple's `NEPacketTunnelProvider` /
   `NETunnelProviderManager` (what every WireGuard-style VPN subclasses) list
   iOS/iPadOS/macOS/tvOS/visionOS — **watchOS is excluded** at the class level
   ([NEPacketTunnelProvider](https://developer.apple.com/documentation/networkextension/nepackettunnelprovider),
   [Apple VPN deployment overview](https://support.apple.com/guide/deployment/vpn-overview-depae3d361d0/web)).
   → **Tailscale, NetBird, ZeroTier all have no watchOS app and cannot build one.**
   Confirmed: none list watchOS on their App Store pages.
2. **An independent (off-iPhone) cellular Watch can only do high-level URLSession
   HTTPS.** `URLSessionWebSocketTask`, raw sockets, and WebRTC/WKWebView are not
   reliably available when the Watch is away from its phone (tightened in watchOS 9)
   ([Apple forum guidance](https://developer.apple.com/forums/thread/714796),
   [WKWebView availability](https://developer.apple.com/documentation/webkit/wkwebview)).
   → **The Watch cannot run live WebRTC voice at all.** It must do turn-based voice:
   record → HTTPS upload → audio response.
3. **APNs is a doorbell, not a transport** (4 KB payload; VoIP push unavailable on
   watchOS) ([APNs payload](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CreatingtheNotificationPayload.html)).

**Consequence: "one path for all devices" is physically impossible.** But "one stable
HTTPS endpoint + one token that every device shares" is achievable, with live WebRTC
as an *upgrade layer* for phone-class devices only.

## Options compared

Scored on: (A) works on Watch/cellular, (B) low-latency WebRTC voice, (C) setup ease,
(D) reliability, (E) cost at solo scale, (F) CGNAT-proof, (G) auth model.

| Option | A Watch | B Voice | C Easy | D Reliable | E Cost | F CGNAT | G Auth |
|---|---|---|---|---|---|---|---|
| **CF named Tunnel** (domain on CF) | ✅ HTTPS | ⚠️ signaling only (no UDP media) | ⚠️ needs domain | ✅ stable host, WS+SSE | Free | ✅ outbound-only | ✅ CF Access (Google/OTP) |
| CF **quick** Tunnel (current) | ✅ HTTPS | ⚠️ no SSE | ✅ 1 cmd | ❌ random URL, testing-only | Free | ✅ | ⚠️ token only |
| **CF Realtime TURN** (current) | — (media) | ✅ relay for P2P | ✅ already wired | ✅ anycast global | $0.05/GB, **1000 GB/mo free** | ✅ | short-lived creds |
| **Tailscale** (+Funnel) | ❌ no watchOS | ✅ direct/DERP, no own TURN | ✅ SSO, zero-config | ✅ (Funnel BW cap undocumented) | Free (6 users) | ✅ | SSO/OIDC |
| NetBird | ❌ no watchOS | ✅ direct/relay | ✅ 1-cmd self-host | ✅ | Free (5 users/100 machines) | ✅ | WireGuard+SSO |
| ZeroTier | ❌ no watchOS | ⚠️ symmetric-NAT → relay | ✅ | ✅ | Free **10 devices/1 net** | ✅ (weak on symmetric) | controller CA |
| ngrok | ✅ HTTPS | ⚠️ no UDP media | ✅ | ✅ paid; free rotates URL | $$ for stable domain | ✅ | basic/OAuth add-ons |

Key: no tunnel (CF/ngrok/Funnel) carries **WebRTC UDP media** — tunnels are
HTTP/WS/TCP only ([CF Tunnel protocols](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/)).
Live media always needs either TURN (relay) or a mesh overlay. Overlays (Tailscale
etc.) give phone-class devices a direct path with **no own TURN needed** — but can't
touch the Watch.

## Recommendation

**Split by device class, unified by one stable HTTPS endpoint. Keep Cloudflare TURN.**

**Primary (one-vendor, fixes the real bug):**
1. **Replace the quick tunnel with a Cloudflare *named* Tunnel** on a domain you put
   on Cloudflare (e.g. `hive.yourdomain.com`). Stable hostname forever, **full
   WebSocket + SSE** (fixes `/flash/turn` streaming), free. Add **Cloudflare Access**
   (Google / one-time-PIN) for a real auth layer. This is the single highest-leverage
   change — it makes "pair once" and remote streaming actually work.
2. **Keep Cloudflare Realtime TURN** for iPhone/glasses live WebRTC media (already
   built, reliable, 1000 GB/mo free — you won't approach it).
3. **Apple Watch → turn-based `/voice/turn` over the same named-tunnel HTTPS URL.**
   No WebRTC, no WebSocket. Already exists via `runFlashTurnText`.

**Every device uses the same base URL + token.** Live WebRTC is an opt-in upgrade for
phone-class devices; anything that can't (Watch) or isn't connected falls back to the
turn-based path automatically — same endpoint, same auth, degraded to request/response.

**Optional simplification for phone-class devices:** add **Tailscale** to Mac +
iPhone + glasses (same account, zero-config). They then reach the Mac at a stable
100.x tailnet IP and live voice can ride the overlay **without your own TURN**. This
does not help the Watch, so the named tunnel stays regardless — Tailscale is purely a
"drop the TURN dependency for the phone" nicety, not the backbone.

**Fallback if you don't want to own a domain:** **Tailscale Funnel** gives a stable
`*.ts.net` public URL for the Watch's HTTPS path (free, TLS-only ports 443/8443/10000;
**undocumented bandwidth cap** — fine for turn-based voice, don't stream 4K through it).

## Migration sketch (repo)

- **`src/lib/tunnel/cloudflared.ts` + `/tunnel/start`:** swap quick tunnel → named
  tunnel (stable hostname + tunnel token). Keep the `cf-connecting-ip` token-gating
  in `src/daemon/server.ts:340-347`; layer Cloudflare Access in front.
- **`src/lib/voice/realtime-session.ts`:** no change — Cloudflare TURN minting stays.
- **Pairing UX:** encode `{ baseUrl (named-tunnel host), token }` in a QR the phone
  and Watch scan once. Fixes the rotating-URL re-pair pain.
- **Watch/glasses audio return:** confirm `runFlashTurnText` (`/voice/turn`) returns
  audio the Watch can play (audio blob or HLS URL), since the Watch can't do WebRTC.
- **Optional:** document Tailscale-for-phone as an advanced path that lets the iOS
  client prefer the tailnet IP and skip TURN.

## Open questions to confirm with the user

1. **Do you own a domain** you can move to Cloudflare? (Enables named Tunnel + Access —
   the recommended path.) If not → Tailscale Funnel fallback.
2. **Is the Mac behind CGNAT?** All recommended options are CGNAT-proof (outbound-only
   tunnel / overlay), so this is informational, not blocking.
3. **Which glasses?** If Android/phone-class they run the full WebRTC stack like the
   phone; if they tether, they mirror the phone. (Not verified against a specific 2026
   product.)
4. **Budget:** everything above is effectively **$0** at solo scale (CF Tunnel free,
   TURN 1000 GB/mo free, Tailscale 6-user free).

## Flags / could-not-verify

- Cloudflare Zero Trust Free seat count (50 users) confirmed only on a 2020 CF blog;
  live pricing page is JS-rendered (couldn't re-confirm 2026 date). Not blocking at
  solo scale.
- Tailscale Funnel bandwidth ceiling is real but **unpublished**.
- watchOS negatives are argued from Apple's class-level availability arrays + total
  absence of any vendor watchOS app (strong), not from an explicit vendor "we don't
  support watchOS" sentence. Worth a direct confirmation before making the Watch
  load-bearing.
- `rtc.live.cloudflare.com` SFU/TURN base host is the historical Cloudflare Calls
  endpoint; the code uses it today and it works, but current docs abstract the host.
