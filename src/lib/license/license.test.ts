import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-license-test-"));
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP;

const { verifyLicense, canonicalize, getMachineFingerprintExport, installLicense, getLicenseStatus } = await (async () => {
  const lic = await import("./license");
  const machine = await import("./machine");
  return { ...lic, getMachineFingerprintExport: machine.getMachineFingerprint };
})();

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

function sign(payload: Record<string, unknown>): { payload: never; signature: string } {
  const sig = cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), privateKey).toString("base64");
  return { payload: payload as never, signature: sig };
}

const MACHINE = getMachineFingerprintExport();
const NOW = new Date("2026-06-13T00:00:00Z");

function basePayload(over: Record<string, unknown> = {}) {
  return {
    product: "hivematrix",
    edition: "appliance",
    licensee: "Irv Cassio",
    machineId: MACHINE,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    graceDays: 14,
    features: ["all"],
    ...over,
  };
}

test.after(() => {
  process.env.HOME = ORIG_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("canonicalize is key-order independent", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
});

test("a valid, machine-matched, unexpired license verifies", () => {
  const status = verifyLicense(sign(basePayload()), PUB_PEM, { machineId: MACHINE, now: NOW });
  assert.equal(status.state, "valid");
  assert.equal(status.permitted, true);
  assert.equal(status.edition, "appliance");
  assert.ok((status.daysRemaining ?? 0) > 0);
});

test("an expired license within grace is permitted; beyond grace is not", () => {
  const expired = basePayload({ expiresAt: "2026-06-10T00:00:00Z", graceDays: 14 });
  const grace = verifyLicense(sign(expired), PUB_PEM, { machineId: MACHINE, now: NOW });
  assert.equal(grace.state, "grace");
  assert.equal(grace.permitted, true);
  assert.ok(grace.graceUntil);

  const beyond = verifyLicense(sign(basePayload({ expiresAt: "2026-05-01T00:00:00Z", graceDays: 7 })), PUB_PEM, { machineId: MACHINE, now: NOW });
  assert.equal(beyond.state, "expired");
  assert.equal(beyond.permitted, false);
});

test("a license bound to another machine is rejected", () => {
  const status = verifyLicense(sign(basePayload({ machineId: "someone-elses-machine" })), PUB_PEM, { machineId: MACHINE, now: NOW });
  assert.equal(status.state, "machine_mismatch");
  assert.equal(status.permitted, false);
});

test("a license bound to a retired fingerprint scheme still verifies on the same machine", () => {
  // Migration case (hostname→UUID): the current scheme yields CURRENT, but a
  // license issued under the old scheme carries LEGACY. Passing the acceptable
  // set (as getLicenseStatus does) must NOT lock the box out of its own license.
  const CURRENT = "uuid-scheme-fingerprint";
  const LEGACY = "hostname-scheme-fingerprint";
  const legacyBound = verifyLicense(sign(basePayload({ machineId: LEGACY })), PUB_PEM, { machineId: [CURRENT, LEGACY], now: NOW });
  assert.equal(legacyBound.state, "valid");
  assert.equal(legacyBound.permitted, true);

  // A fingerprint in neither scheme is still a genuine different-machine reject.
  const foreign = verifyLicense(sign(basePayload({ machineId: "some-other-box" })), PUB_PEM, { machineId: [CURRENT, LEGACY], now: NOW });
  assert.equal(foreign.state, "machine_mismatch");
  assert.equal(foreign.permitted, false);
});

test("a tampered payload fails signature verification", () => {
  const signed = sign(basePayload());
  const tampered = { ...signed, payload: { ...basePayload(), edition: "enterprise" } as never };
  const status = verifyLicense(tampered, PUB_PEM, { machineId: MACHINE, now: NOW });
  assert.equal(status.state, "invalid");
  assert.equal(status.permitted, false);
});

test("missing license fails open; unconfigured issuer key fails open (offline-friendly)", () => {
  assert.equal(verifyLicense(null, PUB_PEM, { machineId: MACHINE, now: NOW }).state, "missing");
  assert.equal(verifyLicense(null, PUB_PEM, { machineId: MACHINE, now: NOW }).permitted, true);
  // signed but no issuer key → unlicensed-open, never bricks the box
  const noKey = verifyLicense(sign(basePayload()), "", { machineId: MACHINE, now: NOW });
  assert.equal(noKey.state, "unlicensed");
  assert.equal(noKey.permitted, true);
});

test("installLicense round-trips through the file store with a configured key", () => {
  process.env.HIVEMATRIX_LICENSE_PUBKEY = PUB_PEM;
  try {
    const status = installLicense(sign(basePayload()) as never, NOW);
    assert.equal(status.state, "valid");
    assert.equal(getLicenseStatus(NOW).state, "valid");
  } finally {
    delete process.env.HIVEMATRIX_LICENSE_PUBKEY;
  }
});
