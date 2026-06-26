# Voice Connectivity Setup Design

## Context

HiveMatrix live voice currently needs two different network paths when an iPhone is away from the Mac's LAN:

- Control/signaling: the iOS app reaches the desktop daemon at `/voice/rtc/config` and `/voice/rtc/offer`.
- WebRTC media: the iOS app and the Mac-side realtime server exchange audio over ICE. Off-LAN media usually needs TURN.

The current desktop implementation supports Cloudflare quick/named tunnels for signaling and Cloudflare Realtime TURN for media. When no Cloudflare TURN key is configured, `src/lib/voice/realtime-session.ts` falls back to STUN-only. That can work on LAN and some forgiving networks, but it silently fails for many cellular, hotel, enterprise, or symmetric-NAT cases.

The target scale is thousands of independent users, where each user owns one Mac and one iPhone. It is not one shared hosted HiveMatrix deployment. That changes the economics: the best free path is to avoid central TURN relay traffic for normal committed users, not to find a public TURN pool that can relay everyone forever at no cost.

## Decision

Ship two user-facing connection paths:

1. **Private Link, recommended**: Tailscale on the Mac and iPhone. HiveMatrix uses the Mac's tailnet URL/IP for signaling, and WebRTC uses host candidates over the tailnet. This removes Cloudflare tunnel setup and removes HiveMatrix-managed TURN for the primary off-LAN path.
2. **Quick Link, fallback**: keep the existing quick tunnel path for users who will not install another app. For live voice, use a provider abstraction for managed TURN credentials. Do not bundle static public TURN credentials. Start with existing Cloudflare Realtime support and allow an alternate provider after it passes reliability, quota, and terms checks.

The user-facing promise is:

- Best free, durable setup: install Tailscale on Mac and iPhone, sign in, scan the HiveMatrix QR.
- Zero-install trial setup: start a temporary link, scan the QR, and HiveMatrix shows whether live voice is fully ready or only LAN/STUN ready.

## Goals

1. Make off-LAN voice setup understandable to non-technical users.
2. Remove `~/.hivematrix/config.json` editing from the normal setup path.
3. Add a setup screen that chooses between Private Link and Quick Link instead of exposing Cloudflare as the only mental model.
4. Add a health check that explains exactly which layer is failing: desktop daemon, feature flag, voice runtime, phone reachability, tunnel, ICE/TURN, or live WebRTC readiness.
5. Keep the existing quick/named Cloudflare tunnel implementation working.
6. Keep the iOS pairing payload backward-compatible.
7. Avoid promising that community/free TURN services can carry thousands of users.

## Non-Goals

- Do not host a central HiveMatrix voice SFU.
- Do not require every user to create a Cloudflare account.
- Do not bundle shared static TURN usernames/passwords into the apps.
- Do not remove the existing Cloudflare tunnel path.
- Do not make the iOS app depend on Tailscale APIs. It only needs a reachable daemon URL from the QR/manual setup.
- Do not implement a self-hosted coturn requirement for normal users.

## Approaches Considered

### A. Tailscale-First Private Link

The Mac and iPhone join the same tailnet. The desktop setup screen detects or asks for the Mac's tailnet address, then generates a pairing QR using that URL. Users install and sign into Tailscale once on both devices.

Pros:

- Scales naturally for independent users because HiveMatrix does not relay media.
- Removes Cloudflare tunnel and TURN setup from the recommended path.
- Works well for repeated daily use.
- Clear user guide: install one app, sign in, scan QR.

Cons:

- Requires a second app install and account/sign-in.
- Some users may reject VPN/mesh networking language.

### B. Quick Tunnel plus Managed TURN Broker

HiveMatrix keeps quick tunnel signaling and fetches TURN credentials through a provider abstraction. The provider can be Cloudflare Realtime, ExpressTURN, Metered, or another managed TURN service, but credentials must be short-lived and never static in the app.

Pros:

- Zero extra app install.
- Familiar current flow stays alive.
- Provider can be changed without rewriting iOS.

Cons:

- TURN relays media bandwidth; a central default eventually costs money.
- Free tiers are not reliable product promises for thousands of users.
- Requires quota, rate limit, abuse, and failure messaging.

### C. User-Provided TURN Only

HiveMatrix surfaces TURN fields in Settings and asks users to paste provider credentials.

Pros:

- Simple implementation.
- No central HiveMatrix bandwidth exposure.

Cons:

- Still too much setup burden for non-technical users.
- Does not solve silent failure unless paired with health checks.
- Wrong default for broad adoption.

### Recommendation

Implement A as the recommended setup and B as the fallback. Keep C only as an advanced override.

## Product UX

### Desktop Setup Screen

Replace the current Cloudflare-shaped Remote tab with **Phone Connection**.

Sections:

1. **Connection Health**
   - Shows a compact checklist:
     - Daemon running.
     - Voice feature enabled.
     - Voice runtime ready or provisioning needed.
     - iPhone URL reachable.
     - ICE/TURN status.
     - Live voice status.
   - Includes a refresh button and a "copy diagnostics" action that excludes secrets.

2. **Private Link (recommended)**
   - Explains in one sentence that this is for using the iPhone away from home without a public tunnel.
   - Fields:
     - Mac Private Link URL, defaulting to `http://<tailscale-ip-or-hostname>:3747` when detectable.
   - Detection:
     - Prefer `tailscale ip -4` when the CLI is available.
     - Otherwise accept manual URL entry.
     - Store the selected URL for future QR generation.
   - Actions:
     - "Use Private Link".
     - "Show QR".
   - Help copy:
     - Install Tailscale on the Mac and iPhone.
     - Sign into the same Tailscale account.
     - Confirm the iPhone can reach this Mac.
     - Scan the QR in HiveMatrix-iOS.

3. **Quick Link**
   - Uses the current Cloudflare quick tunnel.
   - Button: "Start Quick Link".
   - Shows generated public URL and pairing QR.
   - Shows live voice relay status:
     - `Ready for live voice`.
     - `LAN/STUN only`.
     - `TURN credentials unavailable`.
     - `Provider quota exceeded`.
   - Copy makes clear this is for trials/ad-hoc access and may depend on managed relay capacity.

4. **Advanced**
   - Named Cloudflare tunnel fields remain.
   - Cloudflare Access service-token fields remain.
   - TURN override fields move here:
     - URLs.
     - Username.
     - Credential.
     - Provider type.
   - The existing `turnKeyId` and `turnApiToken` are represented in UI and saved through a settings endpoint.

### iOS Connect Screen

Update `HiveMatrix/Views/ConnectView.swift` from "Connect to your daemon" with Cloudflare-specific instructions to a connection-first setup:

- Primary action remains "Scan QR to pair".
- Manual URL/token fields remain below scan.
- Connection hints:
  - Private Link: "Use this after Tailscale is on both devices."
  - Quick Link: "Use this for temporary remote access from the Mac setup screen."
- Cloudflare Access remains collapsed under Advanced.
- After a QR scan or manual connect, the app calls the new health endpoint and displays:
  - Connected to daemon.
  - Voice feature off/on.
  - Push-to-talk ready.
  - Live voice ready or why unavailable.

### iOS Settings

Add a **Connection Health** section in `HiveMatrix/Views/SettingsView.swift`:

- Button: refresh health.
- Rows for daemon, route, voice runtime, ICE/TURN, and live voice.
- If Live voice is disabled in the app build, still show the reason. The user should not see "ready" for a hidden feature.

## User Guide

### Recommended Setup: Private Link

1. Install Tailscale on the Mac.
2. Install Tailscale on the iPhone.
3. Sign into the same Tailscale account on both devices.
4. In HiveMatrix desktop, open Settings -> Phone Connection.
5. Choose Private Link.
6. Confirm the displayed Mac URL.
7. Open HiveMatrix-iOS and scan the QR.
8. Run Connection Health. It should show daemon reachable, voice runtime ready, and live voice ready.

User expectation: this is the free durable path for independent Mac+iPhone owners. It may require one app install, but it should not require Cloudflare, JSON editing, or a TURN account.

### Quick Setup: Quick Link

1. In HiveMatrix desktop, open Settings -> Phone Connection.
2. Choose Quick Link.
3. Start the temporary link.
4. Scan the QR in HiveMatrix-iOS.
5. Run Connection Health.

User expectation: task management and push-to-talk should work when the daemon is reachable. Live voice only works off-LAN when the health check reports a TURN relay is ready.

### Advanced Setup: Named Cloudflare

1. Configure a named Cloudflare tunnel to the desktop daemon.
2. Paste the public hostname in Phone Connection -> Advanced.
3. If Cloudflare Access protects the hostname, save service-token credentials.
4. If using Cloudflare Realtime TURN, save the TURN key ID and API token through the UI.
5. Scan the QR and run Connection Health.

User expectation: this path is for users who already understand Cloudflare or need a stable public hostname.

## Technical Design

### Desktop: Connection Settings

Extend `src/lib/tunnel/remote-access-settings.ts` or add a sibling connection settings module with:

```ts
type PhoneConnectionMode = "private-link" | "quick-link" | "named-cloudflare";

interface PhoneConnectionSettings {
  mode?: PhoneConnectionMode;
  privateLinkUrl?: string;
  namedHostname?: string;
  cloudflareAccessClientId?: string;
  cloudflareAccessClientSecret?: string;
  turn?: {
    provider?: "cloudflare" | "static" | "managed-broker";
    urls?: string | string[];
    username?: string;
    credential?: string;
    cloudflareKeyId?: string;
    cloudflareApiToken?: string;
  };
}
```

Backwards compatibility:

- Continue reading existing `namedHostname`, `cloudflareAccessClientId`, and `cloudflareAccessClientSecret`.
- Continue reading current `config.turn`, `config.turnKeyId`, and `config.turnApiToken`.
- New UI writes the new shape, but the voice layer accepts both shapes during migration.

### Desktop: ICE/TURN Provider

Refactor `src/lib/voice/realtime-session.ts` so `getIceServers()` is provider-based:

1. Always include STUN.
2. If current mode is Private Link, return STUN-only and mark TURN relay as not required; WebRTC gathers host candidates from the Mac network interfaces, including the tailnet interface when Tailscale is active.
3. If Cloudflare TURN keys are configured, mint short-lived Cloudflare ICE servers.
4. If static TURN override is configured, return that.
5. If a managed broker is configured, request short-lived ICE servers from it.
6. If none are available, return STUN-only and include a health warning.

The default production app must not contain shared static TURN credentials. Open Relay and Metered can be documented as advanced/dev options, not bundled at product scale.

### Desktop: Health Endpoint

Add:

```http
GET /voice/connectivity/health
```

Response shape:

```ts
type CheckStatus = "ok" | "warn" | "fail" | "unknown";

interface VoiceConnectivityHealth {
  ok: boolean;
  mode: "private-link" | "quick-link" | "named-cloudflare" | "unknown";
  publicUrl: string | null;
  checks: Array<{
    id: string;
    label: string;
    status: CheckStatus;
    detail: string;
    remediation?: string;
  }>;
  ice: {
    hasStun: boolean;
    hasTurn: boolean;
    provider: "private-link" | "cloudflare" | "static" | "managed-broker" | "none";
    relayRequired: boolean;
    expiresAt?: string;
  };
  liveVoice: {
    available: boolean;
    reason?: string;
  };
}
```

Minimum checks:

- `daemon`: current process responding.
- `auth`: request authenticated.
- `voice-feature`: Voice feature enabled.
- `voice-capability`: Apple Silicon/RAM capability.
- `voice-runtime`: provisioned runtime available.
- `signaling-url`: configured URL exists for iOS.
- `tunnel`: quick/named tunnel status when relevant.
- `private-link`: private link URL configured when relevant.
- `ice`: STUN/TURN availability and whether relay is required.
- `realtime-sidecar`: realtime server can start and `/health` responds on loopback.

Health endpoint behavior:

- It must not start a public tunnel by itself.
- It may lazily start the realtime sidecar only if the Voice feature is enabled and the user requested a deep check, or it can report `unknown` with a remediation. The initial implementation should support `?deep=1` for sidecar startup checks.
- It must never return raw TURN secrets, Cloudflare tokens, or Cloudflare Access secrets.
- It should return HTTP 200 for diagnostic payloads even when checks fail, unless the request is unauthenticated.

### Desktop: Pairing QR

Extend the QR payload only when needed:

```json
{
  "type": "hivematrix-connection",
  "version": 1,
  "url": "http://100.x.y.z:3747",
  "token": "<HiveMatrix bearer token>",
  "connectionMode": "private-link"
}
```

Existing iOS clients ignore unknown fields, so `connectionMode` is safe. Cloudflare Access credentials remain optional and only included when configured.

### iOS: API Client

Add to `HiveMatrix/Services/APIClient.swift`:

- `voiceConnectivityHealth()`.
- Typed models for the health response.
- A method to fetch ICE config that reports decode/fetch failures instead of silently returning `nil`.

`LiveVoiceView.swift` should distinguish:

- ICE config unavailable.
- STUN-only while off-LAN may fail.
- TURN present but WebRTC connect failed.
- Realtime sidecar unavailable.

### iOS: Setup and Health UI

Update:

- `HiveMatrix/Views/ConnectView.swift`
- `HiveMatrix/Views/SettingsView.swift`
- `HiveMatrix/Models/Models.swift`
- `HiveMatrixTests/SmokeTests.swift`

The connect screen should be QR-first, with manual URL/token as fallback. It should avoid saying "Cloudflare" in the default path. Cloudflare Access remains advanced.

## Security

- The HiveMatrix bearer token remains the main mobile pairing secret.
- QR generation remains local to the daemon.
- Cloudflare connector tokens are never encoded into QR payloads.
- Cloudflare Access service-token credentials are encoded only when the user explicitly saves them for mobile pairing.
- TURN credentials returned to iOS should be short-lived.
- Health payloads redact usernames/credentials/tokens and expose only provider/status/expiry.
- Quick Link exposes the daemon to the internet; UI copy must say the access token should be treated like a password.

## Testing

Desktop unit tests:

- Parse legacy TURN config.
- Parse new connection settings.
- Private Link mode reports TURN not required.
- Quick Link with no TURN reports STUN-only warning.
- Cloudflare TURN mint failure falls back cleanly and appears in health.
- Static TURN override appears in ICE config and health without returning secrets.
- Pairing payload remains backward-compatible and includes `connectionMode` only as additive metadata.

Desktop endpoint tests:

- `/voice/connectivity/health` returns check rows for healthy, missing runtime, voice feature off, and STUN-only cases.
- Health endpoint redacts secrets.
- Existing `/voice/rtc/config` still returns `{ iceServers: [...] }`.

iOS tests:

- QR payload parsing still accepts version 1 payloads without `connectionMode`.
- QR payload parsing accepts `connectionMode`.
- API client decodes health response.
- Connect screen copy no longer assumes Cloudflare for the default path.
- Live voice surfaces ICE fetch failure distinctly from WebRTC connection failure.

Manual verification:

- Private Link: Mac and iPhone on same Tailscale account, iPhone off Wi-Fi, daemon reachable, push-to-talk works, live voice health is green.
- Quick Link: temporary link pairs, `/health` works, health explains whether TURN is ready.
- LAN-only: no tunnel and no Tailscale, health says local/LAN only instead of implying remote voice works.

Required gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

Because this touches voice/realtime behavior, run:

```bash
npx tsx scripts/qwen-readiness.mts
```

For HiveMatrix-iOS, run the existing Xcode test target after implementing iOS changes.

## Rollout

1. Add health endpoint and settings model while preserving current Cloudflare behavior.
2. Update desktop setup UI to Phone Connection with Private Link, Quick Link, and Advanced sections.
3. Update iOS connect/setup copy and health display.
4. Add provider abstraction around ICE/TURN.
5. Evaluate a non-Cloudflare managed TURN provider behind the abstraction. Do not make it default until quota, reliability, terms, and observability are verified.

## Provider Notes

Current public free tiers are not equal:

- Open Relay: useful as a community/dev fallback, but not a product-scale bundled default.
- Metered: free tier is too small for live voice at scale.
- Cloudflare Realtime TURN: currently the strongest managed free allowance among the checked providers, but still requires account/key setup unless HiveMatrix brokers credentials.
- ExpressTURN: promising because it advertises a large free tier, but needs validation before product default.
- Tailscale: best fit for thousands of independent Mac+iPhone owners because HiveMatrix is not paying to relay their audio.

References:

- https://www.metered.ca/tools/openrelay/
- https://www.metered.ca/pricing
- https://developers.cloudflare.com/realtime/sfu/pricing/
- https://www.expressturn.com/
- https://tailscale.com/docs/account/manage-plans/free-plans-discounts
