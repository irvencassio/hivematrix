# Hybrid Cloudflare Tunnel Ownership Design

## Context

HiveMatrix currently supports two remote-access modes:

- A temporary quick tunnel, started by HiveMatrix with `cloudflared tunnel --url http://localhost:3747`.
- An advanced named tunnel, started by HiveMatrix with `cloudflared tunnel run --token ...` when the operator pastes a connector token and hostname.

The current local machine also has an existing Cloudflare system service running `hivey_tunnel`. Cloudflare now routes the published application `hivey.cassio.io` to `http://127.0.0.1:3747`, and the connector is healthy. However, HiveMatrix cannot see that service as running because `src/lib/tunnel/cloudflared.ts` only tracks child processes started by the HiveMatrix daemon.

The desired product behavior is hybrid ownership:

- Keep the temporary ad-hoc quick tunnel as the default path.
- Make the advanced path first-class for the stable `hivey_tunnel` setup.
- Let HiveMatrix adopt an already-running named connector when present.
- Let HiveMatrix start a named connector itself when the external service is absent.
- Always show a stable QR code from the desktop console for mobile pairing when the named route is available.

## Goals

1. The Remote Access UI clearly separates:
   - Temporary ad-hoc tunnel.
   - Advanced named Cloudflare tunnel.
2. HiveMatrix can display a usable QR pairing code for the stable hostname `https://hivey.cassio.io` even when the named connector is owned by the existing system service.
3. HiveMatrix can start/stop only the connector process it owns directly.
4. HiveMatrix must not pretend it can stop a system LaunchDaemon connector it merely adopted.
5. The pairing QR continues to encode the HiveMatrix URL plus HiveMatrix bearer token locally.
6. Connector tokens are treated as secrets and are never exposed to tunneled visitors.

## Non-Goals

- Do not automate Cloudflare dashboard setup.
- Do not install, uninstall, or rewrite the system `cloudflared` LaunchDaemon in this change.
- Store optional Cloudflare Access service-token credentials only when the user explicitly saves them for mobile pairing.
- Keep the iOS pairing payload backward-compatible while allowing optional Cloudflare Access credentials.

## Proposed UX

### Temporary Tunnel

The current default "Start tunnel" button remains the simple path:

- Label: temporary/ad-hoc tunnel.
- Starts `trycloudflare.com`.
- Shows generated URL and QR.
- Stop button controls the child process.

### Advanced Named Tunnel

The advanced section becomes "Named Cloudflare tunnel".

Fields:

- Connector token: optional unless the operator wants HiveMatrix to start the named connector.
- Public hostname: `hivey.cassio.io`.

Actions:

- "Use hostname / show QR": validates and adopts the hostname for pairing even if the system connector owns the tunnel.
- "Run with token": starts a HiveMatrix-owned named connector using `cloudflared tunnel run --token ...`.

State copy:

- If HiveMatrix owns the connector: "Named tunnel running from HiveMatrix."
- If an external connector appears active or a stable hostname is configured: "Named tunnel route configured; connector may be managed outside HiveMatrix."
- If no QR tool is available: keep the existing `qrencode` warning.

## Technical Design

### Tunnel Mode

Extend tunnel status with a mode/source model:

```ts
type TunnelMode = "none" | "quick" | "named";
type TunnelOwner = "hivematrix" | "external" | "configured";
```

`TunnelStatus` should include:

```ts
mode: TunnelMode;
owner: TunnelOwner | null;
url: string | null;
canStop: boolean;
```

For backward compatibility, keep `running` and `url`.

### Named Route Adoption

Add a function that records a named hostname for pairing without starting a connector:

```ts
configureNamedTunnel(hostname: string): TunnelStatus
```

This stores the normalized public URL in memory initially. It does not require a connector token.

Rationale:

- The QR only needs the public URL and HiveMatrix bearer token.
- The existing Cloudflare system service may already own the connector.
- This avoids duplicate connectors while giving HiveMatrix the desktop pairing surface.

### External Connector Detection

Add conservative local detection:

- Look for running `cloudflared tunnel run --token` processes.
- If such a process exists and a named hostname is configured, report `owner: "external"` and `running: true`.
- Do not read or print the token.
- Do not kill external processes from `/tunnel/stop`.

This detection is best-effort. The authoritative pairing URL still comes from the configured public hostname.

### QR Generation

Update `/tunnel/qr` to accept the current status URL whether it came from:

- Quick tunnel child process.
- HiveMatrix-owned named connector.
- Adopted/configured named hostname.

It still encodes the stable connection material:

```json
{
  "type": "hivematrix-connection",
  "version": 1,
  "url": "https://hivey.cassio.io",
  "token": "<HiveMatrix bearer token>"
}
```

When Cloudflare Access credentials are saved, the QR payload also includes:

```json
{
  "cloudflareAccess": {
    "clientId": "<Cloudflare Access service-token client id>",
    "clientSecret": "<Cloudflare Access service-token client secret>"
  }
}
```

### API Changes

Add endpoint:

```http
POST /tunnel/configure-named
Content-Type: application/json

{
  "hostname": "hivey.cassio.io"
}
```

Update existing endpoints:

- `GET /tunnel`: returns enriched status.
- `POST /tunnel/start`: sets mode to quick and owner to HiveMatrix.
- `POST /tunnel/start-named`: sets mode to named and owner to HiveMatrix.
- `POST /tunnel/stop`: stops only HiveMatrix-owned child processes; preserves externally adopted named config.

## Security

- The connector token remains a Cloudflare infrastructure secret.
- The HiveMatrix bearer token remains the QR secret for mobile pairing.
- Cloudflare Access service-token credentials are stored locally in `~/.hivematrix/remote-access.json` with mode `600` and are included only in the locally generated QR.
- The console already avoids injecting the bearer token into Cloudflare-origin requests; preserve that behavior.
- External tunnel detection must redact tokens and avoid returning process command lines.

## Tests

Add focused tests for `src/lib/tunnel/cloudflared.ts`:

1. `configureNamedTunnel("hivey.cassio.io")` normalizes to `https://hivey.cassio.io`.
2. Configured named status exposes a QR-capable URL without a child process.
3. `stopTunnel()` does not erase configured named URL when no HiveMatrix child exists.
4. Starting a quick tunnel clears/adopts quick mode as HiveMatrix-owned.
5. Pairing payload remains unchanged.

Add server tests if existing server test harness makes endpoint testing cheap. Otherwise keep endpoint behavior covered by unit-level tunnel tests and typecheck.

## Verification

Required gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`npx tsx scripts/qwen-readiness.mts` is not required because this does not touch local-model paths.

## Decisions

- Persist the named public hostname across daemon restarts.
- Keep the HiveMatrix bearer token durable. It already lives in `~/.hivematrix/auth-token` with mode `600`, and mobile pairing should remain a one-time setup unless the operator rotates that token.

## Open Question

Should the QR payload include Cloudflare Access service-token credentials for iOS/API access?

Recommended answer: yes, but only as an explicit advanced option. A Cloudflare Access service token is a long-lived credential; including it in the QR makes iOS setup one-time, but the desktop UI must clearly treat it like a secret. The connector token should still not be encoded in the QR because it is only for running `cloudflared`, not for mobile clients.
