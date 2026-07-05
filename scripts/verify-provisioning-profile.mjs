/**
 * Verify the installed `HiveMatrix Core` Developer ID provisioning profile.
 *
 * `.provisionprofile` / `.mobileprovision` files are CMS-signed plists. We decode
 * them with `security cms -D -i <file>` and match the embedded plist against the
 * expected identity. Parsing is pure + unit-tested (verify-provisioning-profile.test.mjs);
 * the CLI does the filesystem scan and exits non-zero on no match.
 *
 * Distribution is Developer ID (public website DMG / external updater), NOT the
 * Mac App Store — so this is a release-governance gate, not a runtime requirement.
 *
 * Never prints secrets.
 */

import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

// Provisioning profiles live in TWO places depending on the toolchain:
//   - legacy CLI location: ~/Library/MobileDevice/Provisioning Profiles
//   - Xcode 16+ location:  ~/Library/Developer/Xcode/UserData/Provisioning Profiles
// Xcode installs Developer ID macOS profiles into the latter, so BOTH are scanned.
const PROFILE_DIRS = [
  join(homedir(), "Library/MobileDevice/Provisioning Profiles"),
  join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles"),
];

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function firstStringInArray(xml, key) {
  const block = xml.match(new RegExp(`<key>\\s*${reEsc(key)}\\s*</key>\\s*<array>([\\s\\S]*?)</array>`));
  if (!block) return [];
  return [...block[1].matchAll(/<string>\s*([^<]*?)\s*<\/string>/g)].map((m) => m[1]);
}

function stringValue(xml, key) {
  const m = xml.match(new RegExp(`<key>\\s*${reEsc(key)}\\s*</key>\\s*<string>\\s*([^<]*?)\\s*</string>`));
  return m ? m[1] : null;
}

function boolValue(xml, key) {
  const m = xml.match(new RegExp(`<key>\\s*${reEsc(key)}\\s*</key>\\s*<(true|false)\\s*/>`));
  return m ? m[1] === "true" : false;
}

/** Parse a decoded provisioning-profile plist into the fields we gate on. */
export function parseProfilePlist(xml) {
  return {
    name: stringValue(xml, "Name"),
    teamIdentifier: firstStringInArray(xml, "TeamIdentifier")[0] ?? null,
    // The bundle app-id lives in the Entitlements dict. macOS Developer ID
    // profiles use `com.apple.application-identifier`; iOS profiles use the plain
    // `application-identifier`. Accept either (it's the only such string present).
    applicationIdentifier:
      stringValue(xml, "com.apple.application-identifier") ?? stringValue(xml, "application-identifier"),
    platforms: firstStringInArray(xml, "Platform"),
    provisionsAllDevices: boolValue(xml, "ProvisionsAllDevices"),
  };
}

/**
 * Match a parsed profile against the expected {name, bundleId, teamId}, including
 * the Developer-ID-macOS type heuristic. Returns { ok, reasons }.
 *
 * Type heuristic: a Developer ID Application profile for macOS has Platform=OSX
 * and ProvisionsAllDevices=true (it is not device- or App-Store-scoped). An iOS
 * or Mac App Store profile fails this.
 */
export function matchProfile(profile, { name, bundleId, teamId }) {
  const reasons = [];
  if (profile.name !== name) reasons.push(`name is "${profile.name}", expected "${name}"`);
  if (profile.teamIdentifier !== teamId) reasons.push(`team is "${profile.teamIdentifier}", expected "${teamId}"`);
  const expectedAppId = `${teamId}.${bundleId}`;
  if (profile.applicationIdentifier !== expectedAppId) {
    reasons.push(`application-identifier (bundle) is "${profile.applicationIdentifier}", expected "${expectedAppId}"`);
  }
  const isMac = profile.platforms.some((p) => p === "OSX" || p === "macOS");
  if (!isMac || !profile.provisionsAllDevices) {
    reasons.push(`not a Developer ID Application macOS profile (platforms=[${profile.platforms.join(",")}], provisionsAllDevices=${profile.provisionsAllDevices})`);
  }
  return { ok: reasons.length === 0, reasons };
}

function decode(path) {
  try {
    return execFileSync("security", ["cms", "-D", "-i", path], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Scan the profile dirs; return { found, path, profile, reasons } for the first match, else the closest misses. */
export function findMatchingProfile(expected, dirs = PROFILE_DIRS) {
  const misses = [];
  let scanned = 0;
  for (const dir of dirs) {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".provisionprofile") || f.endsWith(".mobileprovision"));
    } catch {
      continue; // dir absent — try the next one
    }
    for (const f of files) {
      scanned++;
      const xml = decode(join(dir, f));
      if (!xml) continue;
      const profile = parseProfilePlist(xml);
      const r = matchProfile(profile, expected);
      if (r.ok) return { found: true, path: join(dir, f), profile, reasons: [] };
      misses.push(`${join(dir, f).replace(homedir(), "~")}: ${r.reasons.join("; ")}`);
    }
  }
  return {
    found: false,
    path: null,
    profile: null,
    reasons: misses.length ? misses : [`no provisioning profiles found in: ${dirs.map((d) => d.replace(homedir(), "~")).join(", ")}`],
  };
}

// CLI: exit 0 if the HiveMatrix Core Developer ID profile is installed + matches,
// else exit 1 with actionable guidance. No secrets printed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const expected = { name: "HiveMatrix Core", bundleId: "com.irvcassio.hivematrix.core", teamId: "8B3CHTY93V" };
  const res = findMatchingProfile(expected);
  if (res.found) {
    console.log(`✓ provisioning profile OK: "${expected.name}" (${expected.teamId}.${expected.bundleId}) at ${res.path}`);
    process.exit(0);
  }
  console.error(`✗ Developer ID provisioning profile "${expected.name}" not found or mismatched.`);
  console.error(`  Expected: name="${expected.name}", app-id=${expected.teamId}.${expected.bundleId}, type=Developer ID Application (macOS).`);
  console.error("  Nearest candidates inspected:");
  for (const r of res.reasons) console.error(`    - ${r}`);
  console.error("  Fix: in the Apple Developer portal create/download the 'HiveMatrix Core' Developer ID");
  console.error("  provisioning profile for com.irvcassio.hivematrix.core (macOS), then double-click it to install");
  console.error("  into ~/Library/MobileDevice/Provisioning Profiles/.");
  process.exit(1);
}
