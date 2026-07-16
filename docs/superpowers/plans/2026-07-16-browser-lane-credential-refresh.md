# Browser Lane — One-Click Sign-In with Saved Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Design doc: `docs/superpowers/specs/2026-07-16-browser-lane-credential-refresh-design.md`. Read it first — it has the full "why," the rejected approaches, and the operator's "surface the need to click" steer that shapes every task below. Do NOT release when done; the operator releases.

## Ground rules for every task

- RED-GREEN-REFACTOR: write the failing test, run it, watch it fail, then write the minimal code to pass.
- Never let a plaintext credential cross a daemon request body, a Task description, a log line, or the audit trail. Only `siteId`/`credentialRef` may appear in any of those.
- Don't touch `adapters/agent-browser.ts`'s `credential_fill` refusal, `executeBrowserBeeRun()`'s access-mode gate, or `SitesViewController.swift` — out of scope, see design doc.

---

## Task 1 — Daemon route: `POST /browser-lane/sites/:id/credential-used` (audit only)

**Files:** `src/daemon/server.ts`, `src/daemon/server.test.ts`

1. In `server.test.ts`, add a new test near the other `browser-lane`/`messagebee` route tests (the `POST /messagebee/self-handles ...` test at ~line 549 is the closest pattern to copy — temp `HOME`/`HIVEMATRIX_DB_PATH`, `_resetDbForTests()`, real `createDaemonServer()` + `fetch`):

   ```ts
   test("POST /browser-lane/sites/:id/credential-used records a human audit entry, never a secret", async (t) => {
     const originalHome = process.env.HOME;
     const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
     const tmp = mkdtempSync(join(tmpdir(), "hm-server-browser-credential-used-"));
     process.env.HOME = tmp;
     process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

     const { _resetDbForTests } = await import("@/lib/db");
     _resetDbForTests();
     t.after(() => {
       _resetDbForTests();
       if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
       if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
       rmSync(tmp, { recursive: true, force: true });
     });

     const { upsertBrowserSite } = await import("@/lib/browser-lane/store");
     upsertBrowserSite({
       id: "example",
       displayName: "Example",
       homeUrl: "https://example.com",
       loginUrl: "https://example.com/login",
       authStrategy: "keychain_password",
       credentialRef: "hivematrix.browser.example.primary",
     });

     const token = getOrCreateToken(DAEMON_TOKEN_FILE);
     const server = createDaemonServer();
     await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
     t.after(() => server.close());
     const { port } = server.address() as AddressInfo;

     const res = await fetch(`http://127.0.0.1:${port}/browser-lane/sites/example/credential-used`, {
       method: "POST",
       headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
       body: JSON.stringify({}),
     });
     assert.equal(res.status, 200);

     const { readAudit } = await import("@/lib/audit/audit");
     const entries = readAudit({ event: "browser:credential_fill", target: "example" });
     assert.equal(entries.length, 1);
     assert.equal(entries[0].actorKind, "human");
     assert.equal(JSON.stringify(entries[0]).includes("password"), false);

     const missing = await fetch(`http://127.0.0.1:${port}/browser-lane/sites/does-not-exist/credential-used`, {
       method: "POST",
       headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
       body: JSON.stringify({}),
     });
     assert.equal(missing.status, 404);
   });
   ```

   Confirm the exact `upsertBrowserSite` required-field shape against `contracts.ts`/`store.test.ts` before running — adjust the fixture if a field is missing/named differently. Run it, confirm it fails (404/no route yet).

2. In `server.ts`, add the route next to `/browser-lane/readiness/mark` (~line 2708-2725):

   ```ts
   // POST /browser-lane/sites/:id/credential-used — audit-only: the native app
   // retrieved a stored credential from the local macOS Keychain for manual
   // sign-in. The secret itself never crosses this boundary (see keychain.ts's
   // NOTE(audit parity)) — this exists solely so the retrieval lands on the
   // audit trail. Always actorKind "human": nothing but that button calls it.
   const credentialUsedMatch = urlPath.match(/^\/browser-lane\/sites\/([^/]+)\/credential-used$/);
   if (req.method === "POST" && credentialUsedMatch) {
     const siteId = decodeURIComponent(credentialUsedMatch[1]);
     const { getBrowserSite } = await import("@/lib/browser-lane/store");
     const site = getBrowserSite(siteId);
     if (!site) { json(res, 404, { ok: false, lane: "browser", error: `unknown site: ${siteId}` }); return; }
     const { recordAudit } = await import("@/lib/audit/audit");
     recordAudit({ ts: "", event: "browser:credential_fill", actor: "operator", actorKind: "human", target: siteId, status: "retrieved" });
     json(res, 200, { ok: true, lane: "browser" });
     return;
   }
   ```

   Place it before any catch-all/`404` fallthrough for `/browser-lane/*`, matching where the neighboring routes sit. Confirm this path is already covered by whatever auth-token check wraps `/browser-lane/*` routes generally (it should be — every other route in this block is) rather than adding a redundant check.

3. Run the test, confirm it's green. Run `npm run typecheck`.

- [ ] Task 1 complete

---

## Task 2 — `jobs.ts`: name the affordance in the desktop-fallback prompt

**Files:** `src/lib/browser-lane/jobs.ts`, `src/lib/browser-lane/jobs.test.ts`

1. In `jobs.test.ts`, extend the existing test `"buildBrowserBeeDesktopFallbackDescription drives the browser via Desktop Lane"` (~line 156) with one new assertion:

   ```ts
   assert.match(description, /Sign in with saved password/, "should point the operator at the one-click credential retrieval button");
   ```

   Run it, confirm it fails.

2. In `jobs.ts`, extend the existing bullet at line 390 (do not change anything else in the function):

   ```ts
   "Stay within the approved domains and the stated workflow scope. Reuse an already-signed-in browser session rather than re-entering credentials; if login is required and no session exists, stop and report that human login is needed — for keychain_password sites, mention that the operator can use Browser Lane's 'Sign in with saved password' button to retrieve the credential without retyping it.",
   ```

3. Run the test, confirm it's green.

- [ ] Task 2 complete

---

## Task 3 — Swift: `BrowserLaneKeychain.readCredential`

**Files:** `browser-lane-app/Sources/BrowserLaneApp/BrowserLaneKeychain.swift`, `scripts/browser-lane-app.test.mjs`

1. In `scripts/browser-lane-app.test.mjs`, add a new test (follow the existing file-read + `assert.match` style used throughout this file):

   ```js
   test("BrowserLaneKeychain can read back a saved credential without a daemon round-trip", () => {
     const keychain = readFileSync(
       join(root, "browser-lane-app/Sources/BrowserLaneApp/BrowserLaneKeychain.swift"),
       "utf8",
     );
     assert.match(keychain, /func readCredential\(siteId: String\) throws -> \(username: String, password: String\)/);
     assert.match(keychain, /kSecReturnData as String: true/);
     assert.match(keychain, /case notFound/);
     assert.match(keychain, /errSecItemNotFound/);
   });
   ```

   Run `node --import tsx/esm --test scripts/browser-lane-app.test.mjs`, confirm the new test fails (function doesn't exist yet).

2. In `BrowserLaneKeychain.swift`, add the `.notFound` case to `BrowserLaneKeychainError` and its `errorDescription`, then add `readCredential`/`readSecret` as specified in the design doc's "Section 1" code sample. Keep `saveCredential`/`deleteCredential`/`saveSecret` unchanged.

3. Re-run the test file, confirm green. Run `swift build` from `browser-lane-app/` to confirm it compiles.

- [ ] Task 3 complete

---

## Task 4 — Swift: `BrowserLaneDaemonClient.recordCredentialUse`

**Files:** `browser-lane-app/Sources/BrowserLaneApp/BrowserLaneDaemonClient.swift`, `scripts/browser-lane-app.test.mjs`

1. Add a source-text test asserting the client has the new method and posts to the right path:

   ```js
   test("BrowserLaneDaemonClient can record a credential-use audit signal", () => {
     const client = readFileSync(
       join(root, "browser-lane-app/Sources/BrowserLaneApp/BrowserLaneDaemonClient.swift"),
       "utf8",
     );
     assert.match(client, /func recordCredentialUse\(siteId: String/);
     assert.match(client, /\/browser-lane\/sites\\\(siteId\)\/credential-used/);
   });
   ```

   (Adjust the path-literal regex to whatever exact string-interpolation form is used — confirm against the `post(path:body:completion:)` helper signature already in the file before locking the assertion.) Confirm it fails.

2. Add the method per the design doc's "Section 3" sample, reusing the existing private `post(path:body:completion:)` helper — do not add a new HTTP call path.

3. Confirm the test passes; `swift build`.

- [ ] Task 4 complete

---

## Task 5 — Swift: `ReadinessViewController` — capability glyph + "Sign in with saved password"

**Files:** `browser-lane-app/Sources/BrowserLaneApp/ReadinessViewController.swift`, `browser-lane-app/Sources/BrowserLaneApp/BrowserLaneDaemonClient.swift` (only if `BrowserLaneDashboardSite` needs `authStrategy`/`loginUrl` already present — both already are, per the current struct; no change needed there), `scripts/browser-lane-app.test.mjs`

1. Add source-text tests:

   ```js
   test("Readiness view offers one-click sign-in only for keychain_password sites, with the required word-boundary guard intact", () => {
     const readiness = readFileSync(
       join(root, "browser-lane-app/Sources/BrowserLaneApp/ReadinessViewController.swift"),
       "utf8",
     );
     assert.match(readiness, /Sign in with saved password/);
     assert.match(readiness, /signInWithSavedCredential/);
     assert.match(readiness, /NSPasteboard/);
     assert.match(readiness, /scheduleClipboardClear|asyncAfter\(deadline: \.now\(\) \+ 45\)/);
     // existing invariant this file must keep respecting:
     assert.doesNotMatch(readiness, /\b(password|token|cookie|secret)\b/);
   });
   ```

   Run it — confirm it fails (nothing added yet). Note: the LAST assertion (the forbidden-words check) should already pass against the *current* file; if the test file doesn't already assert this for `ReadinessViewController.swift` specifically, check the existing combined assertion (it iterates a file list per the design doc's point 6 research) — don't duplicate a check that already runs elsewhere for this file. If it's already covered by an existing parametrized test, skip re-adding it here and only add the four new assertions above it.

2. Implement in `ReadinessViewController.swift`, per the design doc's "Section 2":
   - A `currentSites: [BrowserLaneDashboardSite] = []` property (check first that nothing equivalent already exists before adding it), set at the top of `renderHeader(sites:message:)`.
   - The capability glyph prefix on the `Strategy:` info line in `siteCard()`.
   - The new button in the button row, shown only when `site.authStrategy == "keychain_password"` (the button row is built inline in `siteCard()` today with an unconditional `addArrangedSubview` sequence — switch to conditionally appending this one).
   - `signInWithSavedCredential(_:)` and `scheduleClipboardClear(expected:)` per the design doc.
   - Import `AppKit`'s `NSPasteboard`/`NSAlert` (already implicitly available via the existing `import AppKit`).

3. Re-run the source-text tests, confirm green. `swift build`.

- [ ] Task 5 complete

---

## Task 6 — DECISIONS.md Q21

Add an entry immediately after Q20 (`DECISIONS.md:1456`), same format/level of detail as Q20. Content to capture (see design doc for full reasoning — write this in the repo's established terse decision-record voice, don't just paste the design doc):

- What: a human-only-triggered credential retrieval convenience (native Swift Keychain read → OS clipboard, 45s auto-clear → existing manual sign-in flow), not autonomous credential use.
- Explicitly unchanged: `credential_fill` stays refused in `adapters/agent-browser.ts` (Q20); no agent/task-dispatch path can reach `readCredential` or the new route — this is a native AppKit button, not a lane tool.
- Reconciles Q19 ("lanes/credentials stay operator-gated forever") with the operator's live "surface the need to click" correction on this task's original ask (which had leaned toward full auto-submit).
- Complexity accounting: new product concepts: 0. New persistent stores: 0. New modules: 0 (all edits to existing files). New routes: 1 (audit-only, no secret in body). Explicitly deferred: automatic DOM/AX form-fill, TOTP/recovery-code storage, `AuthBeeSessionRecord` wiring (still deferred per Q20's own doc).
- Code: list the exact files touched by Tasks 1-5 once they're done.

- [ ] Task 6 complete

---

## Task 7 — Full verification gate

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
(cd browser-lane-app && swift build)
```

All must pass clean. No `qwen-readiness.mts` gate (this doesn't touch `src/lib/local-model/`). Do not run any release script — operator releases.

- [ ] Task 7 complete
