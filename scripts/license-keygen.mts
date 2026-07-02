/**
 * Generate the Ed25519 license signing keypair for HiveMatrix.
 *
 *   npx tsx scripts/license-keygen.mts
 *
 * - Writes the private key to ~/.hivematrix/keys/license-ed25519-private.pem (mode 600).
 * - Writes the public key to ~/.hivematrix/keys/license-ed25519-public.pem.
 * - Prints the public key to stdout so it can be baked into src/lib/license/verify.ts.
 * - Refuses to overwrite an existing private key (pass --force to override).
 * - SEPARATE keypair from the updater key — do NOT share keys between subsystems.
 *
 * Operator note: the private key is irreplaceable once licenses are in the wild.
 * Back it up to a secure offline location immediately after generation.
 */

import { generateKeyPairSync } from "crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const force = process.argv.includes("--force");

const keysDir = join(homedir(), ".hivematrix", "keys");
mkdirSync(keysDir, { recursive: true });

const privPath = join(keysDir, "license-ed25519-private.pem");
const pubPath = join(keysDir, "license-ed25519-public.pem");

if (existsSync(privPath) && !force) {
  console.error(`[license-keygen] private key already exists at ${privPath}`);
  console.error("[license-keygen] pass --force to overwrite (DESTRUCTIVE: invalidates all issued licenses)");
  process.stdout.write(readFileSync(pubPath, "utf-8"));
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

writeFileSync(privPath, privPem, { mode: 0o600 });
chmodSync(privPath, 0o600);
writeFileSync(pubPath, pubPem);

console.error(`[license-keygen] generated Ed25519 license keypair in ${keysDir}`);
console.error(`[license-keygen] private key: ${privPath} (mode 600)`);
console.error(`[license-keygen] public key:  ${pubPath}`);
console.error("[license-keygen] --- public key (bake into src/lib/license/verify.ts) ---");
process.stdout.write(pubPem);
