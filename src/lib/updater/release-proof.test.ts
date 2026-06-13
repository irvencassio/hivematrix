import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutoUpdateProof } from "./release-proof";

const base = {
  headCommit: "abc123",
  packageVersion: "0.1.13",
  tauriVersion: "0.1.13",
  sourceVersion: "0.1.13",
  buildNumber: 629,
  tagName: "v0.1.13",
  tagCommit: "abc123",
  releaseExists: true,
  feedVersion: "0.1.13",
  feedSourceCommit: "abc123",
};

test("release proof passes when version, tag, release, and feed all point at HEAD", () => {
  const proof = evaluateAutoUpdateProof(base);
  assert.equal(proof.ok, true);
  assert.equal(proof.checks.every((c) => c.ok), true);
});

test("release proof fails when version sources drift", () => {
  const proof = evaluateAutoUpdateProof({ ...base, tauriVersion: "0.1.12" });
  assert.equal(proof.ok, false);
  assert.ok(proof.checks.some((c) => c.id === "versions-agree" && !c.ok));
});

test("release proof fails when current version tag points at another commit", () => {
  const proof = evaluateAutoUpdateProof({ ...base, tagCommit: "old999" });
  assert.equal(proof.ok, false);
  assert.ok(proof.checks.some((c) => c.id === "tag-points-at-head" && !c.ok));
});

test("release proof fails when feed lacks source commit metadata", () => {
  const proof = evaluateAutoUpdateProof({ ...base, feedSourceCommit: null });
  assert.equal(proof.ok, false);
  assert.ok(proof.checks.some((c) => c.id === "feed-source-commit" && !c.ok));
});

test("release proof fails when feed advertises a different source commit", () => {
  const proof = evaluateAutoUpdateProof({ ...base, feedSourceCommit: "different" });
  assert.equal(proof.ok, false);
  assert.ok(proof.checks.some((c) => c.id === "feed-source-commit" && !c.ok));
});
