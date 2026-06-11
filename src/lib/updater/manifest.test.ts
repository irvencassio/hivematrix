import test from "node:test";
import assert from "node:assert/strict";
import { parseManifest, compareVersions, isUpdateAvailable, type UpdateManifest } from "./manifest";

const validManifest = {
  schemaVersion: 1,
  channel: "stable",
  latest: {
    version: "0.2.0",
    publishedAt: "2026-06-11T00:00:00Z",
    tarballUrl: "https://cdn.hivematrix.app/releases/0.2.0.tar.gz",
    tarballSha256: "abc123",
    signature: "sig456",
    minNodeVersion: "22",
    releaseNotes: "Bug fixes",
  },
};

test("parseManifest: accepts valid manifest", () => {
  const result = parseManifest(validManifest);
  assert.ok(result !== null);
  assert.equal(result!.latest.version, "0.2.0");
  assert.equal(result!.channel, "stable");
  assert.equal(result!.schemaVersion, 1);
});

test("parseManifest: rejects null and non-object input", () => {
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest("string"), null);
  assert.equal(parseManifest(42), null);
});

test("parseManifest: rejects wrong schemaVersion", () => {
  assert.equal(parseManifest({ ...validManifest, schemaVersion: 2 }), null);
});

test("parseManifest: rejects missing required fields", () => {
  const { tarballUrl: _, ...missing } = validManifest.latest;
  assert.equal(parseManifest({ ...validManifest, latest: missing }), null);
});

test("parseManifest: defaults unknown channel to stable", () => {
  const result = parseManifest({ ...validManifest, channel: "nightly" });
  assert.equal(result!.channel, "stable");
});

test("compareVersions: orders versions correctly", () => {
  assert.equal(compareVersions("0.2.0", "0.1.0"), 1);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
});

test("isUpdateAvailable: true when manifest version is newer", () => {
  const manifest = parseManifest(validManifest) as UpdateManifest;
  assert.equal(isUpdateAvailable("0.1.0", manifest), true);
});

test("isUpdateAvailable: false when already on latest", () => {
  const manifest = parseManifest(validManifest) as UpdateManifest;
  assert.equal(isUpdateAvailable("0.2.0", manifest), false);
});

test("isUpdateAvailable: false when current is newer than manifest", () => {
  const manifest = parseManifest(validManifest) as UpdateManifest;
  assert.equal(isUpdateAvailable("0.3.0", manifest), false);
});
