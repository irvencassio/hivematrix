import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Two independently-faked filesystem surfaces are in play here: the sqlite
// DB (browser_sites row count) and ~/.hivematrix/config.json (the flag
// itself). Both need genuine per-test isolation because several cases
// hinge on the *exact* state of each immediately before a call.
//
// DB isolation follows goals/persona-seed.test.ts's per-test freshDb()
// style (HIVEMATRIX_DB_PATH + _resetDbForTests()), not store.test.ts's
// single-shared-DB-for-the-whole-file convention — this feature's cases
// depend on the row count being genuinely 0 or non-0 at a specific moment,
// which a shared, accumulating DB would make order-dependent.
//
// Config isolation follows flash-mcp.test.ts's temp-HOME-override
// technique (mkdtempSync + write <tmp>/.hivematrix/config.json + point
// process.env.HOME at it) since central/config.ts has no test seam of its
// own and no test in the repo calls saveHiveConfig/loadHiveConfig directly.

const ORIGINAL_HOME = process.env.HOME;
const cleanupDirs: string[] = [];

const { _resetDbForTests } = await import("@/lib/db");
const { autoEnableDesktopFallbackOnFirstSite } = await import("./desktop-fallback-auto-enable");
const { upsertBrowserSite } = await import("./store");

test.after(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  delete process.env.HIVEMATRIX_DB_PATH;
  _resetDbForTests();
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
});

/** Point HOME at a fresh temp dir; optionally pre-seed config.json. Omit
 * `initialConfig` to simulate no config file existing at all. */
function freshHome(initialConfig?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "hm-desktop-fallback-home-"));
  cleanupDirs.push(dir);
  if (initialConfig !== undefined) {
    mkdirSync(join(dir, ".hivematrix"), { recursive: true });
    writeFileSync(join(dir, ".hivematrix", "config.json"), JSON.stringify(initialConfig), "utf-8");
  }
  process.env.HOME = dir;
  return dir;
}

function configPathFor(home: string): string {
  return join(home, ".hivematrix", "config.json");
}

/** Point the sqlite singleton at a fresh, empty temp DB file. */
function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "hm-desktop-fallback-db-"));
  cleanupDirs.push(dir);
  process.env.HIVEMATRIX_DB_PATH = join(dir, "test.db");
  _resetDbForTests();
}

function baseSite(id: string): Record<string, unknown> {
  return {
    id,
    displayName: id,
    homeUrl: `https://${id}.example.com/home`,
    authStrategy: "manual_session",
  };
}

// ---------------------------------------------------------------------
// autoEnableDesktopFallbackOnFirstSite — pure config-file logic, no DB
// ---------------------------------------------------------------------

test("autoEnableDesktopFallbackOnFirstSite: no config file at all -> writes browserLane.desktopFallback=true", () => {
  const home = freshHome(); // no config.json written at all
  const result = autoEnableDesktopFallbackOnFirstSite();
  assert.deepEqual(result, { enabled: true });
  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(config.browserLane.desktopFallback, true);
});

test("autoEnableDesktopFallbackOnFirstSite: both canonical and legacy keys absent -> writes true, preserves unrelated config", () => {
  const home = freshHome({ memory: { brainRootDir: "~/_GD/brain" } });
  const result = autoEnableDesktopFallbackOnFirstSite();
  assert.deepEqual(result, { enabled: true });
  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(config.browserLane.desktopFallback, true);
  assert.equal(config.memory.brainRootDir, "~/_GD/brain", "unrelated config must be preserved");
});

test("autoEnableDesktopFallbackOnFirstSite: canonical browserLane.desktopFallback already false -> left false, no write", () => {
  const home = freshHome({ browserLane: { desktopFallback: false } });
  const before = statSync(configPathFor(home)).mtimeMs;
  const result = autoEnableDesktopFallbackOnFirstSite();
  assert.deepEqual(result, { enabled: false });
  assert.equal(statSync(configPathFor(home)).mtimeMs, before, "file must not be rewritten");
  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(config.browserLane.desktopFallback, false);
});

test("autoEnableDesktopFallbackOnFirstSite: canonical browserLane.desktopFallback already true -> no redundant write", () => {
  const home = freshHome({ browserLane: { desktopFallback: true } });
  const before = statSync(configPathFor(home)).mtimeMs;
  const result = autoEnableDesktopFallbackOnFirstSite();
  assert.deepEqual(result, { enabled: false });
  assert.equal(statSync(configPathFor(home)).mtimeMs, before, "must not rewrite when already true");
});

test("autoEnableDesktopFallbackOnFirstSite: legacy browserbee.desktopFallback=true -> canonical key untouched, no write", () => {
  const home = freshHome({ browserbee: { desktopFallback: true } });
  const before = statSync(configPathFor(home)).mtimeMs;
  const result = autoEnableDesktopFallbackOnFirstSite();
  assert.deepEqual(result, { enabled: false });
  assert.equal(statSync(configPathFor(home)).mtimeMs, before);
  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(config.browserLane, undefined, "canonical key must not be created");
});

test("autoEnableDesktopFallbackOnFirstSite: legacy browserbee.desktopFallback=false -> canonical key untouched, no write", () => {
  const home = freshHome({ browserbee: { desktopFallback: false } });
  const before = statSync(configPathFor(home)).mtimeMs;
  const result = autoEnableDesktopFallbackOnFirstSite();
  assert.deepEqual(result, { enabled: false });
  assert.equal(statSync(configPathFor(home)).mtimeMs, before);
  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(config.browserLane, undefined);
});

// ---------------------------------------------------------------------
// upsertBrowserSite wiring — the row-count ("first site") gate itself
// ---------------------------------------------------------------------

test("upsertBrowserSite: first site inserted into an empty table auto-enables desktopFallback", () => {
  freshDb();
  const home = freshHome({});

  upsertBrowserSite(baseSite("first-site"));

  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(config.browserLane.desktopFallback, true);
});

test("upsertBrowserSite: second site added to a non-empty table does not attempt a config write", () => {
  freshDb();
  const home = freshHome({});

  upsertBrowserSite(baseSite("first-site"));
  const afterFirst = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.equal(afterFirst.browserLane.desktopFallback, true, "sanity: first insert did auto-enable");

  // Reset config back to {} so a second, incorrect auto-enable attempt
  // would be directly observable — left at {browserLane:{desktopFallback:true}}
  // it would already read as "true" regardless, masking a bug where the
  // gate re-fires on every insert instead of only the first.
  writeFileSync(configPathFor(home), JSON.stringify({}), "utf-8");

  upsertBrowserSite(baseSite("second-site"));

  const config = JSON.parse(readFileSync(configPathFor(home), "utf-8"));
  assert.deepEqual(config, {}, "second insert on a non-empty table must not touch config at all");
});
