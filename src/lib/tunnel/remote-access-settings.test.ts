import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
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

    const mode = statSync(join(root, ".hivematrix", "remote-access.json")).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote access settings omit blank secrets and normalize empty hostnames", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-remote-access-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const mod = await import(`./remote-access-settings.ts?case=${Date.now()}`);
    mod.saveRemoteAccessSettings({
      namedHostname: "",
      cloudflareAccessClientId: "  ",
      cloudflareAccessClientSecret: "  ",
    });

    assert.deepEqual(mod.readRemoteAccessSettings(), {});
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
