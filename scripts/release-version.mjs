/**
 * Deterministic version/build mutation for the HiveMatrix Developer ID release.
 *
 * Pure string/JSON transforms (unit-tested in release-version.test.mjs) plus a
 * thin `writeVersionFiles()` that applies them to disk. This is the single owner
 * of "bump the version everywhere, keep the three sources in lockstep, never
 * reuse a build number" — logic previously embedded in scripts/release.mjs.
 *
 * Sources kept in sync (design: docs/superpowers/specs/2026-07-05-developer-id-release-design.md):
 *   - package.json .version               (+ package-lock.json)
 *   - src-tauri/tauri.conf.json .version   (marketing version of record)
 *   - src/lib/version.ts VERSION/BUILD_NUMBER/BUILD_DATE  (BUILD_NUMBER monotonic)
 *   - src/lib/version/changelog.ts + CHANGELOG.md (release notes)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const XYZ = /^\d+\.\d+\.\d+$/;

/** "0.1.138" -> "0.1.139". Throws unless the input is x.y.z. */
export function bumpPatch(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`version "${version}" is not x.y.z`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Current BUILD_NUMBER -> next. Throws on non-integer or a result that isn't monotonic (> 1). */
export function nextBuildNumber(current) {
  const n = Number(current);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid BUILD_NUMBER "${current}"`);
  const next = n + 1;
  if (!Number.isInteger(next) || next <= 1) throw new Error(`invalid next BUILD_NUMBER from "${current}"`);
  return next;
}

/** Validate an operator-supplied marketing version; returns it unchanged or throws. */
export function assertMarketingVersion(v) {
  if (!XYZ.test(String(v))) throw new Error(`marketing version "${v}" must be x.y.z`);
  return String(v);
}

/** Rewrite the "version" field of a pretty-printed JSON doc (2-space indent + trailing newline). */
export function setJsonVersion(text, version) {
  const obj = JSON.parse(text);
  obj.version = version;
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Rewrite package-lock.json's top-level + packages[""] version. */
export function setLockVersion(text, version) {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return JSON.stringify(lock, null, 2) + "\n";
}

/** Rewrite VERSION/BUILD_NUMBER/BUILD_DATE in src/lib/version.ts. Throws if unchanged. */
export function applyVersionTs(text, { version, buildNumber, date }) {
  const out = text
    .replace(/(VERSION\s*=\s*)["'][^"']*["']/, `$1"${version}"`)
    .replace(/BUILD_NUMBER\s*=\s*[0-9]+/, `BUILD_NUMBER = ${buildNumber}`)
    .replace(/BUILD_DATE\s*=\s*["'][^"']*["']/, `BUILD_DATE = "${date}"`);
  if (out === text) throw new Error("could not rewrite VERSION/BUILD_NUMBER/BUILD_DATE in src/lib/version.ts");
  return out;
}

/** Prepend a release entry to src/lib/version/changelog.ts. Throws if the anchor is missing. */
export function prependChangelogTs(text, { version, date, note }) {
  const noteEsc = String(note).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const entry = `  { version: "${version}", date: "${date}", note: "${noteEsc}" },\n`;
  // Replacer FUNCTION, not a replacement string: a string replacement would
  // interpret $-patterns coming from `note` ($1, $&, $') as capture references.
  // A note reading "raised $10 to $25" spliced capture group 1 (this file's own
  // CHANGELOG header) into the string literal and broke the build — see the
  // 0.1.210 release abort, 2026-07-16. Note text must always be literal.
  const out = text.replace(/(export const CHANGELOG: ReleaseNote\[\] = \[\n)/, (m) => m + entry);
  if (out === text) throw new Error("could not prepend to changelog.ts (anchor not found)");
  return out;
}

/** Insert a release section into CHANGELOG.md (after the intro, before the first existing section). */
export function insertChangelogMd(text, { version, date, note }) {
  const section = `## v${version} — ${date}\n\n${note || "_Maintenance release._"}\n\n`;
  const marker = text.indexOf("\n## ");
  return marker === -1 ? text.trimEnd() + "\n\n" + section : text.slice(0, marker + 1) + section + text.slice(marker + 1);
}

/** Read the current version/build/date state from src/lib/version.ts + package.json. */
export function readVersionState(repo = process.cwd()) {
  const verTs = readFileSync(join(repo, "src/lib/version.ts"), "utf-8");
  const version = verTs.match(/VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
  const buildNumber = verTs.match(/BUILD_NUMBER\s*=\s*([0-9]+)/)?.[1] ?? null;
  if (!version || !buildNumber) throw new Error("could not read VERSION/BUILD_NUMBER from src/lib/version.ts");
  return { version, buildNumber };
}

/**
 * Apply a new marketing version + incremented build number + date across all
 * source-of-truth files. Deterministic and idempotent per (version, build).
 * Returns the applied { version, buildNumber, date }.
 */
export function writeVersionFiles({ repo = process.cwd(), version, date, note = "" }) {
  assertMarketingVersion(version);
  const state = readVersionState(repo);
  const buildNumber = nextBuildNumber(state.buildNumber);

  const files = {
    "package.json": (t) => setJsonVersion(t, version),
    "package-lock.json": (t) => setLockVersion(t, version),
    "src-tauri/tauri.conf.json": (t) => setJsonVersion(t, version),
    "src/lib/version.ts": (t) => applyVersionTs(t, { version, buildNumber, date }),
    "src/lib/version/changelog.ts": (t) => prependChangelogTs(t, { version, date, note }),
    "CHANGELOG.md": (t) => insertChangelogMd(t, { version, date, note }),
  };
  for (const [rel, transform] of Object.entries(files)) {
    const p = join(repo, rel);
    if (!existsSync(p)) continue;
    writeFileSync(p, transform(readFileSync(p, "utf-8")));
  }
  return { version, buildNumber, date };
}

// CLI: `node scripts/release-version.mjs <version> [note]` writes the files and
// prints the applied build number (consumed by developer-id-release.sh).
if (import.meta.url === `file://${process.argv[1]}`) {
  const version = process.argv[2];
  const note = process.argv[3] ?? "";
  if (!version) { console.error("usage: release-version.mjs <x.y.z> [note]"); process.exit(2); }
  const date = new Date().toISOString().slice(0, 10);
  const applied = writeVersionFiles({ version, date, note });
  console.log(JSON.stringify(applied));
}
