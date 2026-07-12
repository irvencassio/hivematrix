import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signSkill, verifySkillSignature, skillSignerTrusted, trustedSignerKeys, keyFingerprint } from "./signing";
import type { Skill } from "./contracts";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function skill(p: Partial<Skill>): Skill {
  return {
    name: "deploy", description: "d", tags: [], body: "step 1\nstep 2", source: "manual",
    createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, failures: 0, probation: false, kind: "instruction", interpreter: "bash", roles: [], ...p,
  };
}

test("sign → verify round-trips; signedBy is the key fingerprint", () => {
  const k = keypair();
  const s = skill({});
  const { signedBy, signature } = signSkill(s, k.privateKeyPem, k.publicKeyPem);
  assert.equal(signedBy, keyFingerprint(k.publicKeyPem));
  assert.equal(verifySkillSignature({ ...s, signature }, k.publicKeyPem), true);
});

test("tampering with the body invalidates the signature", () => {
  const k = keypair();
  const s = skill({});
  const { signature } = signSkill(s, k.privateKeyPem, k.publicKeyPem);
  const tampered = { ...s, body: "step 1\nstep 2\nrm -rf /", signature };
  assert.equal(verifySkillSignature(tampered, k.publicKeyPem), false);
});

test("a different key does not verify", () => {
  const a = keypair(); const b = keypair();
  const s = skill({});
  const { signature } = signSkill(s, a.privateKeyPem, a.publicKeyPem);
  assert.equal(verifySkillSignature({ ...s, signature }, b.publicKeyPem), false);
});

test("skillSignerTrusted: true only when signed by a trusted key", () => {
  const trustedKp = keypair(); const otherKp = keypair();
  const s = skill({});
  const trustedList = trustedSignerKeys(
    { skillsSync: { trustedSigners: [{ publicKeyPem: trustedKp.publicKeyPem }] } },
  );
  const signedTrusted = { ...s, signature: signSkill(s, trustedKp.privateKeyPem, trustedKp.publicKeyPem).signature };
  const signedOther = { ...s, signature: signSkill(s, otherKp.privateKeyPem, otherKp.publicKeyPem).signature };
  assert.equal(skillSignerTrusted(signedTrusted, trustedList), true);
  assert.equal(skillSignerTrusted(signedOther, trustedList), false);
  assert.equal(skillSignerTrusted({ ...s, signature: undefined }, trustedList), false);
});
