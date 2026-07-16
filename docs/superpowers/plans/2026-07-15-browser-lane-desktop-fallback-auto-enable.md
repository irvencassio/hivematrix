# Browser Lane desktopFallback Auto-Enable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-browser-lane-desktop-fallback-auto-enable-design.md`

One new module + one new test file, plus a small edit to
`src/lib/browser-lane/store.ts` — one task, one subagent.

## Task 1 — Add `autoEnableDesktopFallbackOnFirstSite`, wire into `upsertBrowserSite`

Files:
- New: `src/lib/browser-lane/desktop-fallback-auto-enable.ts`
- New: `src/lib/browser-lane/desktop-fallback-auto-enable.test.ts`
- Edit: `src/lib/browser-lane/store.ts` (`upsertBrowserSite`, line 118)

### Reused (do not reimplement)

- `loadHiveConfig`, `saveHiveConfig` from `@/lib/central/config` — the
  atomic-write config pair. Do not use `readHiveConfig` from
  `@/lib/brain/settings` (no atomic-write counterpart) and do not hand-roll
  `writeFileSync`.
- `_resetDbForTests` from `@/lib/db` — test-only DB singleton reset, same
  tool `store.test.ts` and `goals/persona-seed.test.ts` already use.
- `upsertBrowserSite` from `./store` — call it directly in the wiring tests;
  do not hand-write an `INSERT` in the test file.

### Do not touch

- `src/lib/browser-lane/jobs.ts` — `readBrowserBeeDesktopFallbackEnabled` and
  the backing-decision logic are correct and already tested. No edits.
- `src/lib/browser-lane/store.test.ts` — has its own shared-DB-per-file
  convention; leave it untouched. The new wiring tests live in the new test
  file instead, which needs true per-test DB isolation.

- [ ] **Red:** Create `src/lib/browser-lane/desktop-fallback-auto-enable.test.ts`:

  ```ts
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
  ```

  Run `npm test -- --test-name-pattern desktop-fallback-auto-enable` (or the
  full `npm test`) and confirm this fails with a module-not-found error on
  `await import("./desktop-fallback-auto-enable")` — proving red for the
  right reason.

- [ ] **Green:** Create `src/lib/browser-lane/desktop-fallback-auto-enable.ts`:

  ```ts
  import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";

  /**
   * Reads a nested `<key>.desktopFallback` value out of a HiveConfig-shaped
   * object, tolerating a missing/non-object block. Mirrors the exact
   * object-shape check jobs.ts's readBrowserBeeDesktopFallbackEnabled already
   * uses for these same two keys.
   */
  function readDesktopFallbackFlag(config: Record<string, unknown>, key: "browserLane" | "browserbee"): unknown {
    const block = config[key];
    if (block && typeof block === "object" && !Array.isArray(block)) {
      return (block as Record<string, unknown>).desktopFallback;
    }
    return undefined;
  }

  export interface AutoEnableDesktopFallbackResult {
    /** True only if this call actually wrote browserLane.desktopFallback = true. */
    enabled: boolean;
  }

  /**
   * Auto-enable the opt-in Browser Lane Desktop fallback (see
   * readBrowserBeeDesktopFallbackEnabled, jobs.ts) the moment the operator
   * adds their first authenticated browser site. Every browser_sites row is
   * inherently "authenticated" — authStrategy has no anonymous/public value
   * (contracts.ts) — so the caller (store.ts's upsertBrowserSite) determines
   * "first" by checking the table had zero rows immediately before the
   * insert, and calls this function only in that case.
   *
   * Never overrides an explicit operator choice: a no-op unless BOTH the
   * canonical `browserLane.desktopFallback` and legacy
   * `browserbee.desktopFallback` keys are entirely absent from config.
   * Present-but-false, present-but-true (including the canonical key already
   * being true, which would otherwise be a redundant write), and
   * present-under-the-legacy-key are all left exactly as the operator set
   * them. See DECISIONS.md's 2026-06-14 Browser Lane entry: Desktop fallback
   * is a deliberate reliability trade-off (lower-reliability local-model
   * browser driving vs. Codex Computer Use) the operator opts into — this
   * auto-enable exists to help operators who never knew the flag existed,
   * not to silently flip anyone's already-made choice.
   */
  export function autoEnableDesktopFallbackOnFirstSite(): AutoEnableDesktopFallbackResult {
    const config = loadHiveConfig();
    const canonical = readDesktopFallbackFlag(config, "browserLane");
    const legacy = readDesktopFallbackFlag(config, "browserbee");
    if (canonical !== undefined || legacy !== undefined) {
      return { enabled: false };
    }

    const existingBrowserLane = config.browserLane;
    const browserLaneBlock =
      existingBrowserLane && typeof existingBrowserLane === "object" && !Array.isArray(existingBrowserLane)
        ? (existingBrowserLane as Record<string, unknown>)
        : {};

    saveHiveConfig({
      ...config,
      browserLane: { ...browserLaneBlock, desktopFallback: true },
    });
    return { enabled: true };
  }
  ```

  Run `npm test` again (scoped or full) and confirm the new
  `autoEnableDesktopFallbackOnFirstSite` tests pass. The two
  `upsertBrowserSite` wiring tests still fail at this point (the call site
  isn't wired yet) — that's expected; continue to the next step.

- [ ] **Wire into `upsertBrowserSite`.** In `src/lib/browser-lane/store.ts`:

  Add the import (near the top, alongside the existing `./contracts` import):

  ```ts
  import { autoEnableDesktopFallbackOnFirstSite } from "./desktop-fallback-auto-enable";
  ```

  Change `upsertBrowserSite` (currently starting at line 118) from:

  ```ts
  export function upsertBrowserSite(input: unknown): BrowserSite {
    const site = normalizeBrowserSite(input);
    const db = getDb();
    db.prepare(`
      INSERT INTO browser_sites (_id, displayName, homeUrl, loginUrl, allowedDomains, profileRef, authStrategy, providerAccount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(_id) DO UPDATE SET
        displayName = excluded.displayName,
        loginUrl = excluded.loginUrl,
        allowedDomains = excluded.allowedDomains,
        profileRef = excluded.profileRef,
        authStrategy = excluded.authStrategy,
        providerAccount = excluded.providerAccount,
        notes = excluded.notes,
        updatedAt = datetime('now')
    `).run(
      site.id,
      site.displayName,
      site.homeUrl,
      site.loginUrl,
      JSON.stringify(site.allowedDomains),
      site.profileRef,
      site.authStrategy,
      site.providerAccount,
      site.notes,
    );

    // A credential row exists only for keychain_password sites — that is the one
    // strategy with a real secret behind the reference. SSO/manual sites carry no
    // credentialRef secret (any "session label" is non-secret metadata on the site).
    if (site.authStrategy === "keychain_password" && site.credentialRef) {
      db.prepare(`
        INSERT INTO browser_credentials (_id, siteId, credentialRef, kind, allowedDomains, status)
        VALUES (?, ?, ?, 'keychain_password', ?, 'unknown')
        ON CONFLICT(credentialRef) DO UPDATE SET
          siteId = excluded.siteId,
          allowedDomains = excluded.allowedDomains,
          updatedAt = datetime('now')
      `).run(generateId(), site.id, site.credentialRef, JSON.stringify(site.allowedDomains));
    }

    return getBrowserSite(site.id)!;
  }
  ```

  to (only two additions: the `isFirstSite` read before the insert, and the
  guarded call before the final `return`; note the exact SQL text above is
  reproduced only for context — do not alter it beyond what's shown):

  ```ts
  export function upsertBrowserSite(input: unknown): BrowserSite {
    const site = normalizeBrowserSite(input);
    const db = getDb();
    const isFirstSite = (db.prepare(`SELECT COUNT(*) AS count FROM browser_sites`).get() as { count: number }).count === 0;
    db.prepare(`
      INSERT INTO browser_sites (_id, displayName, homeUrl, loginUrl, allowedDomains, profileRef, authStrategy, providerAccount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(_id) DO UPDATE SET
        displayName = excluded.displayName,
        loginUrl = excluded.loginUrl,
        allowedDomains = excluded.allowedDomains,
        profileRef = excluded.profileRef,
        authStrategy = excluded.authStrategy,
        providerAccount = excluded.providerAccount,
        notes = excluded.notes,
        updatedAt = datetime('now')
    `).run(
      site.id,
      site.displayName,
      site.homeUrl,
      site.loginUrl,
      JSON.stringify(site.allowedDomains),
      site.profileRef,
      site.authStrategy,
      site.providerAccount,
      site.notes,
    );

    // A credential row exists only for keychain_password sites — that is the one
    // strategy with a real secret behind the reference. SSO/manual sites carry no
    // credentialRef secret (any "session label" is non-secret metadata on the site).
    if (site.authStrategy === "keychain_password" && site.credentialRef) {
      db.prepare(`
        INSERT INTO browser_credentials (_id, siteId, credentialRef, kind, allowedDomains, status)
        VALUES (?, ?, ?, 'keychain_password', ?, 'unknown')
        ON CONFLICT(credentialRef) DO UPDATE SET
          siteId = excluded.siteId,
          allowedDomains = excluded.allowedDomains,
          updatedAt = datetime('now')
      `).run(generateId(), site.id, site.credentialRef, JSON.stringify(site.allowedDomains));
    }

    // Every browser_sites row is inherently an authenticated site (authStrategy
    // has no anonymous/public value) — so "first authenticated site added" is
    // exactly "table had zero rows immediately before this call." See
    // desktop-fallback-auto-enable.ts for the must-not-override guard.
    if (isFirstSite) {
      autoEnableDesktopFallbackOnFirstSite();
    }

    return getBrowserSite(site.id)!;
  }
  ```

  Run `npm test` again and confirm all tests in
  `desktop-fallback-auto-enable.test.ts` now pass, including the two
  `upsertBrowserSite` wiring tests.

- [ ] Re-run the full verification gate (below). Confirm `store.test.ts`
  passes unchanged (it wasn't touched, but its shared DB now also goes
  through this code path on every insert — its assertions don't check
  `~/.hivematrix/config.json` at all, so no interference is expected, but
  confirm the full file still passes green).

## Verification gate (per AGENTS.md)

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`qwen-readiness.mts` not required — this touches only
`src/lib/browser-lane/`, not `src/lib/local-model/`, `qwen-profile.ts`, or
`models/backends.ts`.

## Out of scope / explicitly not touched

- `src/lib/browser-lane/jobs.ts` — `readBrowserBeeDesktopFallbackEnabled` and
  the backing-decision logic, unchanged.
- `src/lib/browser-lane/store.test.ts` — unchanged; new wiring tests live in
  the new test file, which needs true per-test DB isolation this file's
  convention doesn't provide.
- No migration of the legacy `browserbee.desktopFallback` key.
- No new persistent store, table, or column.
- No release/build/publish step. Operator releases.
