import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("pairingPayload keeps the original shape when Access credentials are absent", async () => {
  const mod = await import(`./cloudflared.ts?case=${Date.now()}`);

  assert.equal(
    mod.pairingPayload("https://hivey.cassio.io", "hm-token"),
    JSON.stringify({
      type: "hivematrix-connection",
      version: 1,
      url: "https://hivey.cassio.io",
      token: "hm-token",
    }),
  );
});

test("pairingPayload includes optional Cloudflare Access credentials for one-time mobile setup", async () => {
  const mod = await import(`./cloudflared.ts?case=${Date.now()}`);

  assert.equal(
    mod.pairingPayload("https://hivey.cassio.io", "hm-token", {
      cloudflareAccessClientId: "client-id",
      cloudflareAccessClientSecret: "client-secret",
    }),
    JSON.stringify({
      type: "hivematrix-connection",
      version: 1,
      url: "https://hivey.cassio.io",
      token: "hm-token",
      cloudflareAccess: {
        clientId: "client-id",
        clientSecret: "client-secret",
      },
    }),
  );
});

test("configured named tunnel persists hostname and exposes a QR-capable status without a child process", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    const status = mod.configureNamedTunnel("hivey.cassio.io");

    assert.equal(status.mode, "named");
    assert.equal(status.owner, "configured");
    assert.equal(status.running, true);
    assert.equal(status.canStop, false);
    assert.equal(status.url, "https://hivey.cassio.io");
    assert.equal(mod.tunnelStatus().url, "https://hivey.cassio.io");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateNamedTunnelAccess saves a secret without wiping a previously-saved client id", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    // Save both, then save ONLY the secret (blank id) — the id must survive.
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: "cid-123", cloudflareAccessClientSecret: "sec-1" });
    const status = mod.updateNamedTunnelAccess({ cloudflareAccessClientId: "", cloudflareAccessClientSecret: "sec-2" });

    assert.equal(status.cloudflareAccessClientId, "cid-123", "client id preserved when only the secret is re-saved");
    assert.equal(status.cloudflareAccessSecretSaved, true);
    assert.equal(status.cloudflareAccessConfigured, true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("tunnelStatus exposes saved-credential state but never the secret value", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: "cid-xyz", cloudflareAccessClientSecret: "super-secret" });
    const status = mod.tunnelStatus();

    assert.equal(status.cloudflareAccessClientId, "cid-xyz");
    assert.equal(status.cloudflareAccessSecretSaved, true);
    // The secret must not appear anywhere in the serialized status.
    assert.ok(!JSON.stringify(status).includes("super-secret"), "secret is never serialized into status");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopping a configured named tunnel does not erase persisted hostname", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    mod.configureNamedTunnel("https://hivey.cassio.io/");
    mod.stopTunnel();

    const status = mod.tunnelStatus();
    assert.equal(status.mode, "named");
    assert.equal(status.owner, "configured");
    assert.equal(status.running, true);
    assert.equal(status.canStop, false);
    assert.equal(status.url, "https://hivey.cassio.io");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
