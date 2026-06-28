#!/usr/bin/env node
/**
 * Deterministic HiveMatrix release. One command: bump → commit → push main →
 * build signed/notarized .app + DMG → publish the GitHub release + update feed →
 * prove the live feed. After this, installed users get the update pill and new
 * users get a DMG. Designed to be wrapped by the `release-hivematrix` SCRIPT SKILL
 * (so it's AI-launchable) but is fully runnable by hand.
 *
 * Usage:
 *   node scripts/release.mjs                 # auto-bump patch
 *   node scripts/release.mjs 0.2.0           # explicit version
 *   node scripts/release.mjs 0.2.0 "notes"   # version + commit note
 *
 * Fails fast at every step. Requires (per docs/RELEASE.md): Developer ID cert,
 * notarytool profile `hivematrix`, Rust+cargo-tauri, and the Tauri updater key at
 * ~/.hivematrix/tauri-updater.key(+.password). Apple Silicon only.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const repo = process.cwd();
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: repo, stdio: "inherit", ...opts });
const cap = (cmd) => execSync(cmd, { cwd: repo, encoding: "utf-8" }).trim();
const die = (msg) => { console.error(`\n✗ release: ${msg}\n`); process.exit(1); };
const step = (n, msg) => console.log(`\n=== [${n}] ${msg} ===`);

function bumpPatch(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) die(`current version "${v}" is not x.y.z`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// ── 0. Preconditions ────────────────────────────────────────────────────────
const branch = cap("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") die(`must be on main to release (on "${branch}")`);

const notaryAppleId = "cassio.irv@gmail.com";
const notaryTeamId = "8B3CHTY93V";
const notaryProfile = "hivematrix";
const notaryKeychainService = "com.apple.gke.notary.tool";
const notaryKeychainAccount = `${notaryKeychainService}.saved-creds.${notaryProfile}`;
const notaryKeychainLookupCommand = `security find-generic-password -s "${notaryKeychainService}" -a "${notaryKeychainAccount}"`;
const notaryHistoryCommand = `xcrun notarytool history --apple-id ${notaryAppleId} --team-id ${notaryTeamId} --keychain-profile ${notaryProfile}`;

try {
  execSync(notaryKeychainLookupCommand, { cwd: repo, stdio: "ignore" });
} catch {
  die(
    "notarytool Keychain item is missing. Expected:\n" +
    `  service: ${notaryKeychainService}\n` +
    `  account: ${notaryKeychainAccount}\n\n` +
    "Verify with:\n" +
    `  ${notaryKeychainLookupCommand}\n\n` +
    "Then run: bash scripts/setup-notary.sh",
  );
}

try {
  execSync(notaryHistoryCommand, { cwd: repo, stdio: "ignore" });
} catch {
  die(
    `notarytool profile "${notaryProfile}" exists at ${notaryKeychainService} / ${notaryKeychainAccount}, ` +
    `but is not usable for ${notaryAppleId} / ${notaryTeamId}.\n\n` +
    "Failed command:\n" +
    `  ${notaryHistoryCommand}\n\n` +
    "Run: bash scripts/setup-notary.sh",
  );
}

const keyPath = join(homedir(), ".hivematrix", "tauri-updater.key");
const keyPw = join(homedir(), ".hivematrix", "tauri-updater.key.password");
if (!existsSync(keyPath) || !existsSync(keyPw)) {
  die("missing Tauri updater key (~/.hivematrix/tauri-updater.key + .password) — installed apps can't verify updates without it");
}

const pkgPath = join(repo, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const arg = process.argv[2];
const note = process.argv[3] ?? "";
const version = arg && /^\d+\.\d+\.\d+$/.test(arg) ? arg : bumpPatch(pkg.version);
const today = new Date().toISOString().slice(0, 10);
console.log(`Releasing HiveMatrix ${pkg.version} → ${version}${note ? ` (${note})` : ""}`);

if (cap(`git tag -l v${version}`)) die(`tag v${version} already exists — never re-use a version for new code`);

// ── 1. Version bump (the app/package files that must agree) ─────────────────
step(1, "bump version in package.json, package-lock.json, tauri.conf.json, version.ts");
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const lockPath = join(repo, "package-lock.json");
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

const tauriPath = join(repo, "src-tauri", "tauri.conf.json");
const tauri = JSON.parse(readFileSync(tauriPath, "utf-8"));
tauri.version = version;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

const verTsPath = join(repo, "src", "lib", "version.ts");
const verTs = readFileSync(verTsPath, "utf-8");
const buildMatch = verTs.match(/export const BUILD_NUMBER = ([0-9]+)/);
if (!buildMatch) die("could not read BUILD_NUMBER in src/lib/version.ts");
const nextBuildNumber = Number(buildMatch[1]) + 1;
if (!Number.isInteger(nextBuildNumber) || nextBuildNumber <= 1) {
  die(`invalid next BUILD_NUMBER from ${buildMatch[1]}`);
}
const nextVerTs = verTs
  .replace(/(VERSION\s*=\s*)["'][^"']*["']/, `$1"${version}"`)
  .replace(/BUILD_NUMBER\s*=\s*[0-9]+/, `BUILD_NUMBER = ${Number(buildMatch[1]) + 1}`)
  .replace(/BUILD_DATE\s*=\s*["'][^"']*["']/, `BUILD_DATE = ${JSON.stringify(today)}`);
if (nextVerTs === verTs) die("could not bump VERSION/BUILD_NUMBER/BUILD_DATE in src/lib/version.ts");
writeFileSync(verTsPath, nextVerTs);

// Release notes: prepend this release to the changelog (the in-app Release notes
// view reads changelog.ts via GET /releases; CHANGELOG.md is the human/GitHub copy).
const noteEsc = note.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const clogTsPath = join(repo, "src", "lib", "version", "changelog.ts");
const clogTs = readFileSync(clogTsPath, "utf-8");
const tsEntry = `  { version: "${version}", date: "${today}", note: "${noteEsc}" },\n`;
const nextClogTs = clogTs.replace(/(export const CHANGELOG: ReleaseNote\[\] = \[\n)/, `$1${tsEntry}`);
if (nextClogTs === clogTs) die("could not prepend to changelog.ts");
writeFileSync(clogTsPath, nextClogTs);

const clogMdPath = join(repo, "CHANGELOG.md");
if (existsSync(clogMdPath)) {
  const md = readFileSync(clogMdPath, "utf-8");
  const mdEntry = `## v${version} — ${today}\n\n${note || "_Maintenance release._"}\n\n`;
  // Insert after the intro paragraph (first blank line following the title block).
  const marker = md.indexOf("\n## ");
  writeFileSync(clogMdPath, marker === -1 ? md.trimEnd() + "\n\n" + mdEntry : md.slice(0, marker + 1) + mdEntry + md.slice(marker + 1));
}

// ── 2. Sanity gates before publishing anything ──────────────────────────────
step(2, "typecheck + scope-wall + tests");
sh("npx tsc --noEmit");
sh("npm run scope-wall");
sh("npm test");

// ── 3. Commit + push main ───────────────────────────────────────────────────
step(3, "commit + push to main");
sh("git add -A");
sh(`git commit -m ${JSON.stringify(`Release HiveMatrix ${version}${note ? ` ${note}` : ""}`)}`);
sh("git push origin main");

// ── 4. Build signed/notarized .app + DMG (with the updater signing key) ─────
step(4, "build signed app + DMG");
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf-8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(keyPw, "utf-8").trim(),
};
sh("bash scripts/build-app.sh", { env });
sh(`bash scripts/build-dmg.sh ${version}`, { env });

// ── 5. Publish the GitHub release + update feed ─────────────────────────────
step(5, "publish release + latest.json (the update feed)");
sh("bash scripts/publish-release.sh", { env });

// ── 6. Prove the live feed (the update pill works) ──────────────────────────
step(6, "verify the live auto-update feed");
sh("npm run release:verify");

console.log(`\n✓ Released HiveMatrix ${version}. Update pill is live for installed users; DMG is published for new users.\n`);
