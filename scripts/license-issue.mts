/**
 * Issue and install a HiveMatrix license on THIS machine.
 *
 *   npx tsx scripts/license-issue.mts [--edition pro] [--licensee you@example.com]
 *                                     [--years 5] [--unbound] [--force]
 *
 * The counterpart to scripts/license-keygen.mts. It:
 *   1. Ensures the Ed25519 issuer keypair exists in ~/.hivematrix/keys/
 *      (generates one if absent — this becomes the product's signing key).
 *   2. Configures the issuer PUBLIC key in ~/.hivematrix/config.json under
 *      `license.publicKeyPem`, so the local verifier (resolveIssuerPublicKey)
 *      trusts licenses signed by it — no rebuild needed.
 *   3. Signs a license payload with the PRIVATE key and installs it via the
 *      project's own installLicense(), writing ~/.hivematrix/license.json.
 *
 * Machine-bound by default (payload.machineId = this Mac's fingerprint); pass
 * --unbound for a portable license. Verification stays 100% local/offline.
 *
 * Operator note: the private key is irreplaceable once licenses are in the wild.
 * Back up ~/.hivematrix/keys/ to a secure offline location.
 */

import { generateKeyPairSync, createPrivateKey, sign as edSign } from "crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { canonicalize, installLicense, type LicensePayload, type SignedLicense } from "../src/lib/license/license.ts";
import { getMachineFingerprint } from "../src/lib/license/machine.ts";
import { checkGate } from "../src/lib/license/gates.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const edition = arg("edition", "pro")!;
const licensee = arg("licensee", "cassio.irv@gmail.com")!;
const years = Number(arg("years", "5"));
const bound = !has("unbound");

const hmDir = join(homedir(), ".hivematrix");
const keysDir = join(hmDir, "keys");
mkdirSync(keysDir, { recursive: true });
const privPath = join(keysDir, "license-ed25519-private.pem");
const pubPath = join(keysDir, "license-ed25519-public.pem");

// 1. Issuer keypair — reuse if present, else generate.
if (!existsSync(privPath)) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
  chmodSync(privPath, 0o600);
  writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }).toString());
  console.error(`[license-issue] generated new issuer keypair in ${keysDir}`);
} else {
  console.error(`[license-issue] reusing issuer keypair in ${keysDir}`);
}
const privPem = readFileSync(privPath, "utf-8");
const pubPem = readFileSync(pubPath, "utf-8");

// 2. Trust the public key locally (config override → resolveIssuerPublicKey).
const configPath = join(hmDir, "config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
const licenseCfg = (config.license && typeof config.license === "object" ? config.license : {}) as Record<string, unknown>;
if (licenseCfg.publicKeyPem !== pubPem && !has("force") && typeof licenseCfg.publicKeyPem === "string" && licenseCfg.publicKeyPem.trim()) {
  console.error("[license-issue] config already has a DIFFERENT license.publicKeyPem; pass --force to replace it");
  process.exit(1);
}
config.license = { ...licenseCfg, publicKeyPem: pubPem };
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.error(`[license-issue] set license.publicKeyPem in ${configPath}`);

// 3. Build, sign, install the license.
const now = new Date();
const expires = new Date(now.getTime());
expires.setUTCFullYear(expires.getUTCFullYear() + years);
const payload: LicensePayload = {
  product: "hivematrix",
  edition,
  licensee,
  machineId: bound ? getMachineFingerprint() : null,
  issuedAt: now.toISOString(),
  expiresAt: expires.toISOString(),
  graceDays: 30,
  // Enforcement keys on edition==="pro"; list the Pro features for auditability.
  features: ["channel_mail", "channel_message", "voice", "companion_pairing", "directives"],
};
const signature = edSign(null, Buffer.from(canonicalize(payload), "utf8"), createPrivateKey(privPem)).toString("base64");
const signed: SignedLicense = { payload, signature };
const status = installLicense(signed, now);

console.error(`[license-issue] installed ${configPath.replace("config.json", "license.json")}`);
console.log(JSON.stringify({
  status,
  companion_pairing: checkGate("companion_pairing"),
  machineBound: bound,
}, null, 2));
