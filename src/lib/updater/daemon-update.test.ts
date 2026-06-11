import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-daemon-update-"));
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP;
mkdirSync(join(TMP, ".hivematrix"), { recursive: true });

const { getUpdaterConfig, checkUpdateStatus, CURRENT_VERSION } = await import("./daemon-update");

function writeConfig(cfg: Record<string, unknown>) {
  writeFileSync(join(TMP, ".hivematrix", "config.json"), JSON.stringify(cfg));
}

test.after(() => {
  process.env.HOME = ORIG_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("getUpdaterConfig: defaults when no updater config", () => {
  writeConfig({});
  const c = getUpdaterConfig();
  assert.equal(c.channelUrl, null);
  assert.equal(c.channel, "stable");
  assert.equal(c.publicKeyPem, null);
});

test("getUpdaterConfig: reads channel + url + inline public key", () => {
  writeConfig({ updater: { channelUrl: "https://cdn/x.json", channel: "beta", publicKeyPem: "-----KEY-----" } });
  const c = getUpdaterConfig();
  assert.equal(c.channelUrl, "https://cdn/x.json");
  assert.equal(c.channel, "beta");
  assert.equal(c.publicKeyPem, "-----KEY-----");
});

test("getUpdaterConfig: reads public key from file path", () => {
  const keyPath = join(TMP, "pub.pem");
  writeFileSync(keyPath, "-----FILEKEY-----");
  writeConfig({ updater: { channelUrl: "https://cdn/x.json", publicKeyPath: keyPath } });
  assert.equal(getUpdaterConfig().publicKeyPem, "-----FILEKEY-----");
});

test("checkUpdateStatus: reports not-configured when no channel url", async () => {
  writeConfig({});
  const s = await checkUpdateStatus();
  assert.equal(s.configured, false);
  assert.equal(s.available, false);
  assert.equal(s.currentVersion, CURRENT_VERSION);
});

test("getUpdaterConfig: builds auth headers from a token file (private channel)", () => {
  const tokenPath = join(TMP, "token");
  writeFileSync(tokenPath, "ghp_secrettoken\n");
  writeConfig({ updater: {
    channelUrl: "https://api.github.com/repos/o/r/releases/assets/1",
    authTokenPath: tokenPath, accept: "application/octet-stream",
  } });
  const c = getUpdaterConfig();
  assert.ok(c.headers);
  assert.equal(c.headers!.Authorization, "Bearer ghp_secrettoken");
  assert.equal(c.headers!.Accept, "application/octet-stream");
});

test("getUpdaterConfig: no headers when no token configured", () => {
  writeConfig({ updater: { channelUrl: "https://x/m.json" } });
  assert.equal(getUpdaterConfig().headers, undefined);
});
