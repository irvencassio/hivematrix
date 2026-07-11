import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

// Correctly-shaped Cloudflare Access service-token credentials: the client id
// is 32 hex chars + ".access", the secret is 64 hex chars.
const VALID_CLIENT_ID = "0123456789abcdef0123456789abcdef.access";
const VALID_SECRET = "a".repeat(64);
const VALID_SECRET_2 = "b".repeat(64);

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

test("pairingPayload omits cloudflareAccess when only one of the two credentials is present", async () => {
  const mod = await import(`./cloudflared.ts?case=${Date.now()}`);

  assert.equal(
    mod.pairingPayload("https://hivey.cassio.io", "hm-token", { cloudflareAccessClientId: "client-id" }),
    JSON.stringify({ type: "hivematrix-connection", version: 1, url: "https://hivey.cassio.io", token: "hm-token" }),
  );
  assert.equal(
    mod.pairingPayload("https://hivey.cassio.io", "hm-token", { cloudflareAccessClientSecret: "client-secret" }),
    JSON.stringify({ type: "hivematrix-connection", version: 1, url: "https://hivey.cassio.io", token: "hm-token" }),
  );
});

test("configured named tunnel persists the hostname but stays not-running until the Cloudflare toggle is on", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    const status = mod.configureNamedTunnel("hivey.cassio.io");

    assert.equal(status.mode, "named");
    assert.equal(status.owner, "configured");
    // Saving a hostname alone doesn't flip the toggle — the daemon reports
    // itself unreachable until cloudflareEnabled is explicitly set.
    assert.equal(status.running, false);
    assert.equal(status.canStop, false);
    assert.equal(status.url, "https://hivey.cassio.io");
    assert.equal(mod.tunnelStatus().url, "https://hivey.cassio.io");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("enabling Cloudflare after a hostname is configured (no connector token) adopts it as running", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    mod.configureNamedTunnel("hivey.cassio.io");
    const settingsMod = await import(`./remote-access-settings.ts?case=${Date.now()}`);
    settingsMod.mergeRemoteAccessSettings({ cloudflareEnabled: true });

    const status = mod.tunnelStatus();
    assert.equal(status.running, true);
    assert.equal(status.mode, "named");
    assert.equal(status.owner, "configured");
    assert.equal(status.canStop, false);
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
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: VALID_CLIENT_ID, cloudflareAccessClientSecret: VALID_SECRET });
    const status = mod.updateNamedTunnelAccess({ cloudflareAccessClientId: "", cloudflareAccessClientSecret: VALID_SECRET_2 });

    assert.equal(status.cloudflareAccessClientId, VALID_CLIENT_ID, "client id preserved when only the secret is re-saved");
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
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: VALID_CLIENT_ID, cloudflareAccessClientSecret: VALID_SECRET });
    const status = mod.tunnelStatus();

    assert.equal(status.cloudflareAccessClientId, VALID_CLIENT_ID);
    assert.equal(status.cloudflareAccessSecretSaved, true);
    // The secret must not appear anywhere in the serialized status.
    assert.ok(!JSON.stringify(status).includes(VALID_SECRET), "secret is never serialized into status");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateNamedTunnelAccess rejects a URL pasted as the client secret and leaves saved credentials untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: VALID_CLIENT_ID, cloudflareAccessClientSecret: VALID_SECRET });

    // The real incident: the public URL saved as the (masked, never-echoed) secret.
    assert.throws(
      () => mod.updateNamedTunnelAccess({ cloudflareAccessClientId: "", cloudflareAccessClientSecret: "https://hivey.cassio.io" }),
      /looks like a URL/,
    );

    const settings = (await import(`./remote-access-settings.ts?case=${Date.now()}`)).readRemoteAccessSettings();
    assert.equal(settings.cloudflareAccessClientId, VALID_CLIENT_ID, "rejected save must not touch the stored id");
    assert.equal(settings.cloudflareAccessClientSecret, VALID_SECRET, "rejected save must not touch the stored secret");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("validateCloudflareAccessCredentials accepts the service-token shape and rejects obvious non-secrets", async () => {
  const mod = await import(`./cloudflared.ts?case=${Date.now()}`);

  assert.equal(mod.validateCloudflareAccessCredentials(VALID_CLIENT_ID, VALID_SECRET), null);
  // Blank fields mean "leave unchanged" and are never an error.
  assert.equal(mod.validateCloudflareAccessCredentials(undefined, undefined), null);
  assert.equal(mod.validateCloudflareAccessCredentials("", ""), null);
  // Uppercase hex is still hex.
  assert.equal(mod.validateCloudflareAccessCredentials(VALID_CLIENT_ID.toUpperCase().replace(".ACCESS", ".access"), VALID_SECRET.toUpperCase()), null);

  assert.match(mod.validateCloudflareAccessCredentials("https://hivey.cassio.io", VALID_SECRET) ?? "", /Client ID looks like a URL/);
  assert.match(mod.validateCloudflareAccessCredentials("not a token.access", VALID_SECRET) ?? "", /doesn't look like a Cloudflare Access service-token client id/);
  assert.match(mod.validateCloudflareAccessCredentials("0123456789abcdef.access", VALID_SECRET) ?? "", /client id/i, "too-short hex id rejected");
  assert.match(mod.validateCloudflareAccessCredentials(VALID_CLIENT_ID, "hunter2") ?? "", /64 hex characters/);
  assert.match(mod.validateCloudflareAccessCredentials(VALID_CLIENT_ID, "http://hivey.cassio.io") ?? "", /Client secret looks like a URL/);
});

test("verifyCloudflareAccess does not attempt a request without a hostname or complete credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("fetch must not be called"); };

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);

    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: VALID_CLIENT_ID, cloudflareAccessClientSecret: VALID_SECRET });
    const noHostname = await mod.verifyCloudflareAccess();
    assert.equal(noHostname.attempted, false);
    assert.match(noHostname.message, /public hostname/);

    mod.configureNamedTunnel("hivey.cassio.io");
    // Wipe the credentials file's secret by writing settings directly.
    const settingsMod = await import(`./remote-access-settings.ts?case=${Date.now()}`);
    settingsMod.saveRemoteAccessSettings({ namedHostname: "hivey.cassio.io", cloudflareAccessClientId: VALID_CLIENT_ID });
    const noSecret = await mod.verifyCloudflareAccess();
    assert.equal(noSecret.attempted, false);
    assert.match(noSecret.message, /both the client id and secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyCloudflareAccess sends CF-Access headers and maps 403 → rejected, non-403 → accepted", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  const originalFetch = globalThis.fetch;

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    mod.configureNamedTunnel("hivey.cassio.io");
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: VALID_CLIENT_ID, cloudflareAccessClientSecret: VALID_SECRET });

    let captured: { url: string; headers: Record<string, string> } | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), headers: (init?.headers ?? {}) as Record<string, string> };
      return new Response(null, { status: 403 });
    }) as typeof fetch;
    const rejected = await mod.verifyCloudflareAccess();
    // TS can't see the closure assignment above; re-read through a cast local.
    const request = captured as { url: string; headers: Record<string, string> } | null;
    assert.ok(request, "verification must issue a request");
    assert.equal(request.url, "https://hivey.cassio.io");
    assert.equal(request.headers["CF-Access-Client-Id"], VALID_CLIENT_ID);
    assert.equal(request.headers["CF-Access-Client-Secret"], VALID_SECRET);
    assert.deepEqual(
      { attempted: rejected.attempted, ok: rejected.ok, status: rejected.status },
      { attempted: true, ok: false, status: 403 },
    );
    assert.match(rejected.message, /rejected/);

    globalThis.fetch = async () => new Response(null, { status: 401 });
    const accepted = await mod.verifyCloudflareAccess();
    assert.deepEqual(
      { attempted: accepted.attempted, ok: accepted.ok, status: accepted.status },
      { attempted: true, ok: true, status: 401 },
    );
    assert.match(accepted.message, /accepted/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyCloudflareAccess reports an unreachable hostname without claiming acceptance or rejection", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-cloudflared-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND hivey.cassio.io"); };

  try {
    const mod = await import(`./cloudflared.ts?case=${Date.now()}`);
    mod.configureNamedTunnel("hivey.cassio.io");
    mod.updateNamedTunnelAccess({ cloudflareAccessClientId: VALID_CLIENT_ID, cloudflareAccessClientSecret: VALID_SECRET });

    const result = await mod.verifyCloudflareAccess();
    assert.equal(result.attempted, true);
    assert.equal(result.ok, null);
    assert.match(result.message, /could not be reached/);
    assert.match(result.message, /ENOTFOUND/);
  } finally {
    globalThis.fetch = originalFetch;
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
    const settingsMod = await import(`./remote-access-settings.ts?case=${Date.now()}`);
    settingsMod.mergeRemoteAccessSettings({ cloudflareEnabled: true });
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
