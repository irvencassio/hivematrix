import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions, resolveStatus } from "./status";

test("compareVersions orders by short version then numeric build", () => {
  assert.equal(compareVersions({ short: "0.1.86", build: "2" }, { short: "0.1.86", build: "2" }), 0);
  assert.ok(compareVersions({ short: "0.1.86", build: "2" }, { short: "0.1.87", build: "1" }) < 0);
  assert.ok(compareVersions({ short: "0.2.0", build: "1" }, { short: "0.1.99", build: "9" }) > 0);
  // Same short version, build is the tiebreaker (numeric, not lexical).
  assert.ok(compareVersions({ short: "0.1.86", build: "2" }, { short: "0.1.86", build: "10" }) < 0);
});

test("resolveStatus reports missing when nothing is installed", () => {
  assert.equal(resolveStatus({ installed: null, expected: { short: "0.1.86", build: "2" } }), "missing");
});

test("resolveStatus is installed when up to date", () => {
  assert.equal(
    resolveStatus({ installed: { short: "0.1.86", build: "2" }, expected: { short: "0.1.86", build: "2" } }),
    "installed",
  );
});

test("resolveStatus is update_available when expected is newer", () => {
  assert.equal(
    resolveStatus({ installed: { short: "0.1.86", build: "2" }, expected: { short: "0.1.87", build: "1" } }),
    "update_available",
  );
  // Newer build alone also counts.
  assert.equal(
    resolveStatus({ installed: { short: "0.1.86", build: "2" }, expected: { short: "0.1.86", build: "3" } }),
    "update_available",
  );
});

test("invalid signature dominates even when the version is up to date", () => {
  assert.equal(
    resolveStatus({
      installed: { short: "0.1.86", build: "2" },
      expected: { short: "0.1.86", build: "2" },
      signatureOk: false,
    }),
    "invalid_signature",
  );
});

// The LaunchServices lesson: codesign/spctl passing does NOT prove the app
// launches. launch_failed is a distinct status from invalid_signature.
test("launch failure is its own status, separate from signature validity", () => {
  const status = resolveStatus({
    installed: { short: "0.1.86", build: "2" },
    expected: { short: "0.1.86", build: "2" },
    signatureOk: true,
    launchOk: false,
  });
  assert.equal(status, "launch_failed");
  assert.notEqual(status, "invalid_signature");
});

test("a healthy install with a good signature and launch is installed", () => {
  assert.equal(
    resolveStatus({
      installed: { short: "0.1.86", build: "2" },
      expected: { short: "0.1.86", build: "2" },
      signatureOk: true,
      launchOk: true,
    }),
    "installed",
  );
});

test("same version but a different build identity is stale_copy, not installed", () => {
  assert.equal(
    resolveStatus({
      installed: { short: "0.1.2", build: "3" },
      expected: { short: "0.1.2", build: "3" },
      installedBuildId: "old1234",
      expectedBuildId: "new5678",
    }),
    "stale_copy",
  );
});

test("same version and same build identity stays installed", () => {
  assert.equal(
    resolveStatus({
      installed: { short: "0.1.2", build: "3" },
      expected: { short: "0.1.2", build: "3" },
      installedBuildId: "same999",
      expectedBuildId: "same999",
    }),
    "installed",
  );
});

test("build identity is ignored when either side is unknown (back-compat)", () => {
  assert.equal(
    resolveStatus({
      installed: { short: "0.1.2", build: "3" },
      expected: { short: "0.1.2", build: "3" },
      expectedBuildId: "new5678", // installed has no build id (legacy bundle)
    }),
    "installed",
  );
});

test("an older version is update_available even if build ids differ", () => {
  assert.equal(
    resolveStatus({
      installed: { short: "0.1.1", build: "2" },
      expected: { short: "0.1.2", build: "3" },
      installedBuildId: "old", expectedBuildId: "new",
    }),
    "update_available",
  );
});
