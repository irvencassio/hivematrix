/**
 * Build a signed release manifest for the HiveMatrix update channel.
 *
 *   npx tsx scripts/release-sign.mts <version> <appBundlePath> <outDir> [tarballBaseUrl]
 *
 * - Generates an Ed25519 signing keypair on first run (private key protected at
 *   ~/.hivematrix/keys/updater-ed25519-private.pem, mode 600; public key at
 *   updater-ed25519-public.pem). Reuses them thereafter.
 * - Tars the .app bundle, computes SHA-256, signs the hash with the private key.
 * - Writes <outDir>/<tarball>.tar.gz and <outDir>/manifest.json.
 *
 * The public key is printed so it can be baked into config.updater.publicKeyPem.
 */

import { generateKeyPairSync, sign as edSign, createPrivateKey, createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";

const [version, appPath, outDir, tarballBaseUrl] = process.argv.slice(2);
if (!version || !appPath || !outDir) {
  console.error("usage: release-sign.mts <version> <appBundlePath> <outDir> [tarballBaseUrl]");
  process.exit(1);
}

const keysDir = join(homedir(), ".hivematrix", "keys");
mkdirSync(keysDir, { recursive: true });
const privPath = join(keysDir, "updater-ed25519-private.pem");
const pubPath = join(keysDir, "updater-ed25519-public.pem");

if (!existsSync(privPath)) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  chmodSync(privPath, 0o600);
  writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }).toString());
  console.error(`[release-sign] generated new Ed25519 keypair in ${keysDir} (private key chmod 600)`);
}

const privateKey = createPrivateKey(readFileSync(privPath, "utf-8"));
const publicKeyPem = readFileSync(pubPath, "utf-8");

mkdirSync(outDir, { recursive: true });
const tarName = `HiveMatrix-${version}-macos.tar.gz`;
const tarPath = join(outDir, tarName);

// Tar the .app bundle (preserve the bundle dir name).
const appDir = appPath.replace(/\/[^/]+$/, "");
const appName = appPath.split("/").pop()!;
execFileSync("tar", ["czf", tarPath, "-C", appDir, appName]);

const tarBytes = readFileSync(tarPath);
const sha256 = createHash("sha256").update(tarBytes).digest("hex");
const signature = edSign(null, Buffer.from(sha256, "utf-8"), privateKey).toString("base64");

const base = (tarballBaseUrl ?? `https://github.com/irvencassio/hivematrix/releases/download/v${version}`).replace(/\/$/, "");
const manifest = {
  schemaVersion: 1,
  channel: "stable",
  latest: {
    version,
    channel: "stable",
    publishedAt: new Date().toISOString(),
    tarballUrl: `${base}/${tarName}`,
    tarballSha256: sha256,
    signature,
    minNodeVersion: "22",
    releaseNotes: `HiveMatrix ${version}`,
  },
  previous: null,
};
const manifestPath = join(outDir, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.error(`[release-sign] tarball: ${tarPath} (${(tarBytes.length / 1048576).toFixed(1)} MB)`);
console.error(`[release-sign] sha256:  ${sha256}`);
console.error(`[release-sign] manifest: ${manifestPath}`);
console.error(`[release-sign] tarballUrl: ${manifest.latest.tarballUrl}`);
console.error(`[release-sign] --- public key (bake into config.updater.publicKeyPem) ---`);
process.stdout.write(publicKeyPem);
