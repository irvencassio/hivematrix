# Hybrid Cloudflare Tunnel Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Task 1: Add Persisted Remote Access Settings

- [x] RED: Add `src/lib/tunnel/remote-access-settings.test.ts`.

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("remote access settings persist named hostname and Access credentials with mode 600", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-remote-access-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./remote-access-settings.ts?case=${Date.now()}`);
    mod.saveRemoteAccessSettings({
      namedHostname: "hivey.cassio.io",
      cloudflareAccessClientId: "client-id",
      cloudflareAccessClientSecret: "client-secret",
    });
    assert.deepEqual(mod.readRemoteAccessSettings(), {
      namedHostname: "https://hivey.cassio.io",
      cloudflareAccessClientId: "client-id",
      cloudflareAccessClientSecret: "client-secret",
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [x] GREEN: Create `src/lib/tunnel/remote-access-settings.ts`.
- [x] Include hostname normalization to `https://...`.
- [x] Persist to `~/.hivematrix/remote-access.json` with mode `600`.

## Task 2: Extend Tunnel Status And Pairing Payload

- [x] RED: Add `src/lib/tunnel/cloudflared.test.ts` coverage for configured named tunnel status and QR payload with optional Cloudflare Access credentials.
- [x] GREEN: Update `src/lib/tunnel/cloudflared.ts`.
- [x] Add status fields:
  - `mode`
  - `owner`
  - `canStop`
  - `cloudflareAccessConfigured`
- [x] Add `configureNamedTunnel(...)`.
- [x] Add `updateNamedTunnelAccess(...)`.
- [x] Keep `pairingPayload(url, token)` backward-compatible and extend it to accept optional Cloudflare Access credentials:

```ts
pairingPayload(url, token, {
  cloudflareAccessClientId,
  cloudflareAccessClientSecret,
})
```

## Task 3: Add Server Endpoints

- [x] RED: If a low-cost daemon server test exists, add endpoint tests. If not, rely on Task 1 and Task 2 unit tests plus typecheck.
- [x] GREEN: Update `src/daemon/server.ts`.
- [x] Add `POST /tunnel/configure-named`.
- [x] Add `POST /tunnel/access-credentials`.
- [x] Update `/tunnel/qr` to include optional Cloudflare Access credentials from persisted settings.

## Task 4: Update Remote Access UI

- [x] RED: Add/update console HTML string tests if existing `src/daemon/console.test.ts` has relevant assertions.
- [x] GREEN: Update `src/daemon/console.ts`.
- [x] Keep temporary tunnel as default.
- [x] Add advanced named-tunnel controls:
  - Public hostname.
  - Save/show QR.
  - Optional Cloudflare Access Client ID.
  - Optional Cloudflare Access Client Secret.
  - Run with connector token.
- [x] Show QR when a named hostname is configured, even if HiveMatrix did not start the connector.
- [x] Disable/clarify Stop behavior for externally configured/adopted named tunnels.

## Task 5: Verify

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `node scripts/scope-wall.mjs`.
- [x] Manually verify local `/tunnel` returns named status after saving `hivey.cassio.io`.
- [x] Manually verify `/tunnel/qr` returns SVG when `qrencode` is installed.
