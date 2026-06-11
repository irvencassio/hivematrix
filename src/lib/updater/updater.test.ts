import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

const TMP = mkdtempSync(join(tmpdir(), "hm-updater-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "hivematrix.db");
// Point backups under a temp HOME so we don't touch the real ~/.hivematrix.
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP;

const {
  sha256Buffer, verifyEd25519, verifyDownload,
  backupDatabase, pruneBackups, restoreDatabase,
  checkForUpdate, applyUpdate,
} = await import("./updater");

test.after(() => {
  process.env.HOME = ORIG_HOME;
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

// --- signature verification ---

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signHex(hex: string): string {
  return cryptoSign(null, Buffer.from(hex, "utf-8"), privateKey).toString("base64");
}

test("verifyEd25519: valid signature passes, tampered fails, no-key fails", () => {
  const msg = Buffer.from("abc123", "utf-8");
  const sig = cryptoSign(null, msg, privateKey).toString("base64");
  assert.equal(verifyEd25519(msg, sig, pubPem), true);
  assert.equal(verifyEd25519(Buffer.from("tampered"), sig, pubPem), false);
  assert.equal(verifyEd25519(msg, sig, null), false); // fail-closed
});

test("verifyDownload: passes only with matching sha256 + valid signature", () => {
  const tarball = join(TMP, "rel.tar.gz");
  const content = Buffer.from("fake-release-bytes");
  writeFileSync(tarball, content);
  const sha = sha256Buffer(content);
  const release = {
    version: "0.2.0", channel: "stable" as const, publishedAt: "", tarballUrl: "x",
    tarballSha256: sha, signature: signHex(sha), minNodeVersion: "22",
  };
  assert.equal(verifyDownload(tarball, release, pubPem).ok, true);
  // wrong sha
  assert.equal(verifyDownload(tarball, { ...release, tarballSha256: "deadbeef" }, pubPem).ok, false);
  // bad signature
  assert.equal(verifyDownload(tarball, { ...release, signature: "AAAA" }, pubPem).ok, false);
  // no key → refuse
  assert.equal(verifyDownload(tarball, release, null).ok, false);
});

// --- DB backup / prune / restore ---

test("backupDatabase + restore round-trips, pruneBackups keeps N", () => {
  writeFileSync(process.env.HIVEMATRIX_DB_PATH!, "DB_V1");
  const b1 = backupDatabase("t");
  assert.ok(b1 && existsSync(b1));
  // mutate, then restore from backup
  writeFileSync(process.env.HIVEMATRIX_DB_PATH!, "DB_V2");
  assert.equal(restoreDatabase(b1!), true);
  assert.equal(readFileSync(process.env.HIVEMATRIX_DB_PATH!, "utf-8"), "DB_V1");

  // create several backups, prune to 2
  for (let i = 0; i < 6; i++) { writeFileSync(process.env.HIVEMATRIX_DB_PATH!, "x"+i); backupDatabase("p"+i); }
  pruneBackups(2);
  const remaining = readdirSync(join(TMP, ".hivematrix", "backups")).filter(f => f.endsWith(".db"));
  assert.equal(remaining.length, 2);
});

// --- check ---

function manifestResponse(version: string, channel = "stable") {
  const body = {
    schemaVersion: 1, channel,
    latest: { version, channel, publishedAt: "", tarballUrl: "https://x/" + version + ".tgz",
      tarballSha256: "abc", signature: "sig", minNodeVersion: "22" },
  };
  return { ok: true, json: async () => body } as unknown as Response;
}

test("checkForUpdate: detects newer version", async () => {
  const fetchImpl = (async () => manifestResponse("0.3.0")) as unknown as typeof fetch;
  const r = await checkForUpdate("0.1.0", "https://chan/stable.json", "stable", fetchImpl);
  assert.equal(r.available, true);
  assert.equal(r.release?.version, "0.3.0");
});

test("checkForUpdate: no update when current is latest", async () => {
  const fetchImpl = (async () => manifestResponse("0.1.0")) as unknown as typeof fetch;
  const r = await checkForUpdate("0.1.0", "https://chan/stable.json", "stable", fetchImpl);
  assert.equal(r.available, false);
});

test("checkForUpdate: channel mismatch rejected", async () => {
  const fetchImpl = (async () => manifestResponse("0.3.0", "beta")) as unknown as typeof fetch;
  const r = await checkForUpdate("0.1.0", "https://chan/stable.json", "stable", fetchImpl);
  assert.equal(r.available, false);
  assert.match(r.error ?? "", /channel mismatch/);
});

// --- apply orchestration ---

function makeRelease() {
  const content = Buffer.from("release-2.0");
  const sha = sha256Buffer(content);
  return {
    content,
    release: { version: "0.2.0", channel: "stable" as const, publishedAt: "", tarballUrl: "x",
      tarballSha256: sha, signature: signHex(sha), minNodeVersion: "22" },
  };
}

test("applyUpdate: full happy path reaches done", async () => {
  writeFileSync(process.env.HIVEMATRIX_DB_PATH!, "live");
  const { content, release } = makeRelease();
  const tarball = join(TMP, "dl.tgz");
  const outcome = await applyUpdate(release, {
    download: async () => { writeFileSync(tarball, content); return tarball; },
    install: async () => {},
    restart: async () => {},
    probe: async () => true,
    publicKeyPem: pubPem,
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.steps, ["downloaded","verified","backed_up","installed","restarted","probed","done"]);
});

test("applyUpdate: failed probe rolls back the DB", async () => {
  writeFileSync(process.env.HIVEMATRIX_DB_PATH!, "good-state");
  const { content, release } = makeRelease();
  const tarball = join(TMP, "dl2.tgz");
  const outcome = await applyUpdate(release, {
    download: async () => { writeFileSync(tarball, content); return tarball; },
    install: async () => { writeFileSync(process.env.HIVEMATRIX_DB_PATH!, "corrupted-by-migration"); },
    restart: async () => {},
    probe: async () => false, // unhealthy → rollback
    publicKeyPem: pubPem,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.rolledBack, true);
  assert.ok(outcome.steps.includes("rolled_back"));
  // DB restored to pre-update state
  assert.equal(readFileSync(process.env.HIVEMATRIX_DB_PATH!, "utf-8"), "good-state");
});

test("applyUpdate: bad signature aborts before backup", async () => {
  const { content, release } = makeRelease();
  const tarball = join(TMP, "dl3.tgz");
  const outcome = await applyUpdate({ ...release, signature: "AAAA" }, {
    download: async () => { writeFileSync(tarball, content); return tarball; },
    install: async () => { throw new Error("should not install"); },
    restart: async () => { throw new Error("should not restart"); },
    probe: async () => true,
    publicKeyPem: pubPem,
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? "", /verification failed/);
  assert.deepEqual(outcome.steps, ["downloaded","failed"]);
});
