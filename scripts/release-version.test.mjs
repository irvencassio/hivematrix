import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bumpPatch,
  nextBuildNumber,
  assertMarketingVersion,
  setJsonVersion,
  setLockVersion,
  applyVersionTs,
  prependChangelogTs,
} from "./release-version.mjs";

test("bumpPatch increments only the patch and rejects non-x.y.z", () => {
  assert.equal(bumpPatch("0.1.138"), "0.1.139");
  assert.equal(bumpPatch("1.2.9"), "1.2.10");
  assert.throws(() => bumpPatch("0.1"), /x\.y\.z/);
  assert.throws(() => bumpPatch("v0.1.1"), /x\.y\.z/);
});

test("nextBuildNumber increments and refuses non-monotonic / invalid input", () => {
  assert.equal(nextBuildNumber("682"), 683);
  assert.equal(nextBuildNumber(682), 683);
  assert.throws(() => nextBuildNumber("0"), /BUILD_NUMBER/);
  assert.throws(() => nextBuildNumber("abc"), /BUILD_NUMBER/);
});

test("assertMarketingVersion accepts x.y.z only", () => {
  assert.equal(assertMarketingVersion("0.2.0"), "0.2.0");
  assert.throws(() => assertMarketingVersion("0.2"), /marketing version/);
  assert.throws(() => assertMarketingVersion("0.2.0-beta"), /marketing version/);
});

test("setJsonVersion updates version, preserves other keys, 2-space indent + trailing newline", () => {
  const src = JSON.stringify({ name: "hivematrix", version: "0.1.138", private: true }, null, 2) + "\n";
  const out = setJsonVersion(src, "0.1.139");
  const parsed = JSON.parse(out);
  assert.equal(parsed.version, "0.1.139");
  assert.equal(parsed.name, "hivematrix");
  assert.equal(parsed.private, true);
  assert.ok(out.endsWith("\n"), "keeps trailing newline");
  assert.ok(out.includes('\n  "name"'), "keeps 2-space indent");
});

test("setLockVersion updates both the top-level and packages[''] version", () => {
  const lock = JSON.stringify({ name: "hivematrix", version: "0.1.138", packages: { "": { name: "hivematrix", version: "0.1.138" } } }, null, 2) + "\n";
  const out = JSON.parse(setLockVersion(lock, "0.1.139"));
  assert.equal(out.version, "0.1.139");
  assert.equal(out.packages[""].version, "0.1.139");
});

test("applyVersionTs rewrites VERSION, BUILD_NUMBER (+1), and BUILD_DATE together", () => {
  const src = [
    'export const VERSION = "0.1.138";',
    "export const BUILD_NUMBER = 682;",
    'export const BUILD_DATE = "2026-07-04";',
  ].join("\n") + "\n";
  const out = applyVersionTs(src, { version: "0.1.139", buildNumber: 683, date: "2026-07-05" });
  assert.match(out, /export const VERSION = "0\.1\.139";/);
  assert.match(out, /export const BUILD_NUMBER = 683;/);
  assert.match(out, /export const BUILD_DATE = "2026-07-05";/);
  assert.doesNotMatch(out, /0\.1\.138/);
  assert.doesNotMatch(out, /682/);
});

test("applyVersionTs throws if it cannot find the constants to rewrite", () => {
  assert.throws(() => applyVersionTs("export const OTHER = 1;\n", { version: "0.1.139", buildNumber: 683, date: "2026-07-05" }), /version\.ts/);
});

test("prependChangelogTs inserts the new release as the first entry", () => {
  const src = [
    "export const CHANGELOG: ReleaseNote[] = [",
    '  { version: "0.1.138", date: "2026-07-04", note: "prev" },',
    "];",
  ].join("\n") + "\n";
  const out = prependChangelogTs(src, { version: "0.1.139", date: "2026-07-05", note: 'has "quotes" and \\ backslash' });
  const firstEntry = out.indexOf('version: "0.1.139"');
  const prevEntry = out.indexOf('version: "0.1.138"');
  assert.ok(firstEntry !== -1 && firstEntry < prevEntry, "new entry precedes the previous one");
  assert.match(out, /note: "has \\"quotes\\" and \\\\ backslash"/, "escapes quotes and backslashes");
});

test("prependChangelogTs keeps $-patterns in the note literal (regression: the 0.1.210 abort)", () => {
  const src = [
    "export const CHANGELOG: ReleaseNote[] = [",
    '  { version: "0.1.209", date: "2026-07-16", note: "prev" },',
    "];",
  ].join("\n") + "\n";
  // A string replacement would expand these as capture references: $1 spliced
  // the CHANGELOG header itself into the literal and broke the build.
  const note = "budget backstop raised $10 to $25; also $& and $' and $`";
  const out = prependChangelogTs(src, { version: "0.1.210", date: "2026-07-16", note });
  assert.ok(out.includes(`note: "${note}"`), "note survives verbatim, no $-expansion");
  assert.ok(!out.includes("note: \"budget backstop raised export const"), "header must not be spliced in");
  // The anchor still appears exactly once — nothing duplicated or eaten.
  assert.equal(out.split("export const CHANGELOG: ReleaseNote[] = [").length - 1, 1);
  const firstEntry = out.indexOf('version: "0.1.210"');
  const prevEntry = out.indexOf('version: "0.1.209"');
  assert.ok(firstEntry !== -1 && firstEntry < prevEntry, "new entry still precedes the previous one");
});
