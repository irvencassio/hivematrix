# Skills & Commands catalog dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-16-skills-catalog-dedup-design.md`. Read it
first — it explains why the dispatch's literal ask ("delete the folder variant")
would regress a live capability, and why the fix instead lives in
`skCatalog()`'s display layer, driven by the existing `.hivematrix-managed.json`
manifest.

**Before running any test code below as the RED step: re-read the actual current
source of the function you're editing and confirm the test's assertions match
reality (imports, exact strings, current line shapes). Plan code is a starting
point, not a transcription to trust blindly — a prior same-day session found two
real bugs in this plan author's own draft test code before they shipped.**

- [ ] Task 1: Export `readManifest` from `src/lib/skills/fanout.ts`

  File: `src/lib/skills/fanout.ts`. Currently (line 58):
  ```ts
  async function readManifest(dir: string): Promise<string[]> {
  ```
  Change to:
  ```ts
  export async function readManifest(dir: string): Promise<string[]> {
  ```
  Pure visibility change — no behavior change, so no new test file is needed, but
  add one line to the existing `fanout.test.ts` proving it's importable and
  behaves as documented (missing dir → `[]`; present manifest → its slugs):

  Add to `src/lib/skills/fanout.test.ts` (extend the existing import on line 6):
  ```ts
  import { planFanout, fanOutSkills, harnessTargets, readManifest, type HarnessTarget } from "./fanout";
  ```
  New test, appended at the end of the file:
  ```ts
  test("readManifest: missing manifest -> [], present manifest -> its slugs", async () => {
    const home = mkdtempSync(join(tmpdir(), "fanout-manifest-"));
    const dir = join(home, ".claude", "skills");
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(await readManifest(dir), [], "no manifest file yet");
    writeFileSync(join(dir, ".hivematrix-managed.json"), JSON.stringify({ slugs: ["alpha", "beta"] }));
    assert.deepEqual(await readManifest(dir), ["alpha", "beta"]);
  });
  ```
  RED: this fails today only because `readManifest` isn't exported (TS compile
  error on the import), not a runtime assertion failure — confirm by running
  `NODE_ENV=test node --import tsx/esm --test src/lib/skills/fanout.test.ts`
  before making the export change, expect an import/type error.
  GREEN: add the `export` keyword, re-run, expect pass.

- [ ] Task 2: Add `managed` to `LocalCommand`, thread through `parseSkillManifest`

  File: `src/lib/commands/contracts.ts`. In the `LocalCommand` interface
  (currently ends at line 51 with `bundledFileCount: number;`), add:
  ```ts
    /** True when this folder skill's SKILL.md is HiveMatrix-owned (written by
     *  fanOutSkills, tracked in that dir's .hivematrix-managed.json) — a mirror
     *  of a brain-library skill, not an independently authored local asset. */
    managed: boolean;
  ```
  `parseCommandFile` (flat commands — fan-out never targets these) sets it
  literally `false` in its returned object (add `managed: false,` alongside the
  existing `hasBundledFiles: false, bundledFileCount: 0,` lines).

  `parseSkillManifest`'s signature changes from:
  ```ts
  export function parseSkillManifest(
    content: string,
    dirName: string,
    sourcePath: string,
    bundledFileCount: number,
  ): LocalCommand {
  ```
  to:
  ```ts
  export function parseSkillManifest(
    content: string,
    dirName: string,
    sourcePath: string,
    bundledFileCount: number,
    managed: boolean,
  ): LocalCommand {
  ```
  and its returned object adds `managed,` (alongside the existing
  `hasBundledFiles: bundledFileCount > 0, bundledFileCount,` lines).

  This is a compile-time-enforced signature change — the one other call site
  (`local-catalog.ts#scanSkills`, Task 3 below) must be updated in the same
  commit or `npm run typecheck` fails, which is the intended RED for this task
  pairing.

  Add to `src/lib/commands/local-catalog.test.ts` (tests for `contracts.ts`
  already live in this file per existing convention — see `parseCommandFile`/
  `splitFrontmatter` tests near the top):
  ```ts
  test("parseSkillManifest: threads the managed flag through verbatim", () => {
    const content = "---\nname: foo\ndescription: d\n---\nbody";
    const managedCmd = parseSkillManifest(content, "foo", "/p/foo/SKILL.md", 0, true);
    assert.equal(managedCmd.managed, true);
    const unmanagedCmd = parseSkillManifest(content, "foo", "/p/foo/SKILL.md", 0, false);
    assert.equal(unmanagedCmd.managed, false);
  });
  test("parseCommandFile: always managed:false (fan-out never targets flat commands)", () => {
    const c = parseCommandFile("---\ndescription: x\n---\nbody", "ns:sub", "/p");
    assert.equal(c.managed, false);
  });
  ```
  RED: run `NODE_ENV=test node --import tsx/esm --test src/lib/commands/local-catalog.test.ts`
  before the signature/field changes — expect a TS error (too few args to
  `parseSkillManifest`, and/or `managed` missing on the asserted object).
  GREEN: after both `contracts.ts` edits, re-run, expect pass. Also run
  `npm run typecheck` at repo root — Task 3 must land alongside this task for
  typecheck to pass (the two are one atomic change; if working across two
  subagent turns, land them in the same task-turn rather than sequential commits
  that leave the tree non-typechecking in between).

- [ ] Task 3: `scanSkills` computes `managed` from the manifest

  File: `src/lib/commands/local-catalog.ts`. Add the import (alongside the
  existing `./contracts` import block, line ~18):
  ```ts
  import { readManifest } from "@/lib/skills/fanout";
  ```
  `scanSkills` currently (lines 73–92):
  ```ts
  async function scanSkills(root: string, out: LocalCommand[]): Promise<void> {
    let dirs: Dirent[];
    try { dirs = await fs.readdir(root, { withFileTypes: true }); }
    catch { return; } // missing dir → skip
    for (const d of dirs) {
      if (out.length >= MAX_COMMANDS) break;
      if (!d.isDirectory()) continue;
      const skillDir = join(root, d.name);
      const manifest = join(skillDir, "SKILL.md");
      const raw = await readWithTimeout(manifest);
      if (raw == null) continue; // no SKILL.md (or stalled) → skip
      if (!skillIsUserInvocable(raw)) continue; // explicitly non-invocable → not runnable
      let bundledFileCount = 0;
      try {
        const inner = await fs.readdir(skillDir);
        bundledFileCount = inner.filter((f) => f !== "SKILL.md").length;
      } catch { /* leave 0 */ }
      out.push(parseSkillManifest(raw, d.name, manifest, bundledFileCount));
    }
  }
  ```
  Change to (two additions: compute `managedSlugs` once up front, pass membership
  into `parseSkillManifest`):
  ```ts
  async function scanSkills(root: string, out: LocalCommand[]): Promise<void> {
    let dirs: Dirent[];
    try { dirs = await fs.readdir(root, { withFileTypes: true }); }
    catch { return; } // missing dir → skip
    const managedSlugs = new Set(await readManifest(root));
    for (const d of dirs) {
      if (out.length >= MAX_COMMANDS) break;
      if (!d.isDirectory()) continue;
      const skillDir = join(root, d.name);
      const manifest = join(skillDir, "SKILL.md");
      const raw = await readWithTimeout(manifest);
      if (raw == null) continue; // no SKILL.md (or stalled) → skip
      if (!skillIsUserInvocable(raw)) continue; // explicitly non-invocable → not runnable
      let bundledFileCount = 0;
      try {
        const inner = await fs.readdir(skillDir);
        bundledFileCount = inner.filter((f) => f !== "SKILL.md").length;
      } catch { /* leave 0 */ }
      out.push(parseSkillManifest(raw, d.name, manifest, bundledFileCount, managedSlugs.has(d.name)));
    }
  }
  ```
  Note `readManifest(root)` — `root` here is the *skills* dir
  (`scanLocalCommands` calls `scanSkills(join(configDir, "skills"), out)`),
  exactly the directory `fanOutSkills`'s `"claude"` target writes
  `.hivematrix-managed.json` into for the default profile. A non-default profile
  or a profile fan-out has never targeted just yields an empty set (`readManifest`
  already never throws) → `managed: false` for everything, same as today.

  Add to `src/lib/commands/local-catalog.test.ts`, using the existing fixture
  layout (the file already creates `CFG/skills/puller/SKILL.md` and
  `CFG/skills/quietskill/SKILL.md` at module load, lines 14–32) — add a manifest
  declaring `puller` managed but not `quietskill`:
  ```ts
  writeFileSync(
    join(CFG, "skills", ".hivematrix-managed.json"),
    JSON.stringify({ slugs: ["puller"], updatedAt: "2026-07-16T00:00:00.000Z" }),
  );
  ```
  (Add this alongside the other fixture `writeFileSync` calls, before the
  `scanLocalCommands`/`readManifestBody` import on line 34 — module-load-time
  fixture setup, matching the file's existing pattern.)

  New test:
  ```ts
  test("scanLocalCommands: managed is true only for slugs in .hivematrix-managed.json", async () => {
    const all = await scanLocalCommands();
    const puller = all.find((c) => c.invokeName === "puller");
    assert.equal(puller?.managed, true, "puller is listed in the fixture manifest");
    // quietskill is filtered out earlier by user-invocable:false, so it can't be
    // asserted here directly — covered instead by the always-false command case:
    const cmd = all.find((c) => c.kind === "command");
    assert.equal(cmd?.managed, false, "flat commands are never fan-out targets");
  });
  ```
  RED: run `NODE_ENV=test node --import tsx/esm --test src/lib/commands/local-catalog.test.ts`
  before this task's edits (after Task 2 already landed) — `puller`'s `managed`
  is `undefined`/fails the assertion since `scanSkills` doesn't compute it yet.
  GREEN: after the `scanSkills` edit, re-run, expect pass. Then run the full
  suite for this file once more to confirm no other existing test in it broke
  (it asserts specific shapes of `puller`/`quietskill`/`import-all` elsewhere).

- [ ] Task 4: Dedupe managed mirrors in `skCatalog()`

  File: `src/daemon/console.ts`. Current (lines 3661–3672):
  ```js
  function skCatalog() {
    const lib = _skills.map(s => ({
      source: 'lib', key: 'lib:' + s.name, name: s.name, description: s.description || '',
      kind: s.kind, scope: s.scope, signed: s.signed, trusted: s.trusted, scan: s.scan,
      compat: s.compat, hasInput: s.hasInput, useCount: s.useCount || 0, raw: s,
    }));
    const loc = _commands.map(c => ({
      source: 'local', key: 'local:' + c.invokeName, name: c.displayName || c.invokeName,
      description: c.description || '', kind: c.kind, invokeName: c.invokeName, compat: c.compat, useCount: 0, raw: c,
    }));
    return lib.concat(loc);
  }
  ```
  Change to (filter `_commands` before mapping; everything else identical):
  ```js
  function skCatalog() {
    const lib = _skills.map(s => ({
      source: 'lib', key: 'lib:' + s.name, name: s.name, description: s.description || '',
      kind: s.kind, scope: s.scope, signed: s.signed, trusted: s.trusted, scan: s.scan,
      compat: s.compat, hasInput: s.hasInput, useCount: s.useCount || 0, raw: s,
    }));
    const libNames = new Set(_skills.map(s => s.name.toLowerCase()));
    const loc = _commands
      .filter(c => !(c.kind === 'skill' && c.managed && libNames.has((c.displayName || c.invokeName).toLowerCase())))
      .map(c => ({
        source: 'local', key: 'local:' + c.invokeName, name: c.displayName || c.invokeName,
        description: c.description || '', kind: c.kind, invokeName: c.invokeName, compat: c.compat, useCount: 0, raw: c,
      }));
    return lib.concat(loc);
  }
  ```
  Only a local `kind:'skill'` row that is BOTH `managed` AND shadowed by a
  present lib entry of the same name is dropped — `developer-id-release`
  (`managed:false`, no lib counterpart) and every flat command are untouched.

  This repo's console.ts tests are static source-structure assertions on the
  extracted client script (no jsdom/live DOM — see the existing
  `Tools panel has a real-time search box...` test in `console.test.ts` around
  line 2816 for the established pattern: `extractScript(CONSOLE_HTML)` +
  `fnBody(js, "fnName")` + regex assertions). Add near that section (after the
  last `skCatalog`/skill-list related test block — search `console.test.ts` for
  `"skCatalog"` or `"renderSkillList"` to find the right neighborhood; if none
  exists yet, add a new block at the end of the file):
  ```ts
  // ─── Skills & Commands: dedupe HiveMatrix-managed local mirrors (2026-07-16) ─
  // See docs/superpowers/specs/2026-07-16-skills-catalog-dedup-design.md and
  // docs/superpowers/plans/2026-07-16-skills-catalog-dedup.md, Task 4.

  test("skCatalog: drops a managed local skill row when a same-named lib skill is present", () => {
    const js = extractScript(CONSOLE_HTML);
    const fn = fnBody(js, "skCatalog");

    // The filter runs on _commands before the loc map, keyed off c.managed and
    // a lib-name lookup — not a slug reimplementation, not touching _skills'
    // own mapping at all.
    assert.match(fn, /libNames\s*=\s*new Set\(_skills\.map\(s => s\.name\.toLowerCase\(\)\)\)/,
      "builds a lowercase lib-name lookup from _skills");
    assert.match(fn, /_commands\s*\n?\s*\.filter\(/, "filters _commands before mapping to loc rows");
    assert.match(fn, /c\.kind === 'skill' && c\.managed && libNames\.has/,
      "only a managed folder-skill entry shadowed by a present lib name is dropped");

    // lib mapping itself is untouched by this change.
    assert.match(fn, /const lib = _skills\.map\(s => \(\{/, "lib mapping unchanged");
  });
  ```
  RED: run
  `NODE_ENV=test node --import tsx/esm --test src/daemon/console.test.ts`
  before the `skCatalog()` edit — the new regexes don't match the current
  concatenation-only source, test fails.
  GREEN: after the edit, re-run, expect pass, and confirm no pre-existing
  `console.test.ts` test broke (this file is large — run the whole file, not a
  filtered subset).

- [ ] Task 5: Full verification gates (not delegated — run directly)

  From repo root:
  ```
  npm run typecheck
  npm test
  node scripts/scope-wall.mjs
  ```
  All three must be clean (typecheck zero errors, test suite fully green modulo
  the one pre-existing unrelated skip this repo's suite already carries,
  scope-wall zero violations — no new persistent store or concept was added, so
  no DECISIONS.md entry is expected or needed).

  Then a live sanity check against the *design doc's* stated expectation — port
  the dedup filter into a throwaway check against the running daemon's actual
  current catalogs (same shape as the investigation script, not a new permanent
  script):
  ```bash
  TOKEN=$(cat ~/.hivematrix/auth-token)
  python3 - <<'EOF'
  import json, urllib.request
  token = open("/Users/irvcassio/.hivematrix/auth-token").read().strip()
  def get(path):
      req = urllib.request.Request(f"http://127.0.0.1:3747{path}", headers={"Authorization": f"Bearer {token}"})
      return json.load(urllib.request.urlopen(req))
  skills = get("/skills")["skills"]
  commands = get("/commands")["commands"]
  lib_names = {s["name"].lower() for s in skills}
  survivors = [c for c in commands if not (c["kind"] == "skill" and c.get("managed") and c["invokeName"].lower() in lib_names)]
  dupes = [c for c in survivors if c["kind"] == "skill" and c["invokeName"].lower() in lib_names]
  print("local rows before filter:", len(commands))
  print("local rows after filter:", len(survivors))
  print("remaining overlap (should be 0):", len(dupes))
  EOF
  ```
  This is a **running-daemon check**, so it only reflects the fix once the
  daemon process has picked up the new `/commands` response shape (`managed`
  field) — the daemon likely needs restarting to pick up a `src/daemon/server.ts`
  dependency change (`local-catalog.ts` → `contracts.ts`). If the daemon is
  running from a build older than this change, `managed` will be `undefined` on
  every row and "remaining overlap" will still read 45 — that's expected release
  lag, not a fix failure; note it in the commit/known-issues entry rather than
  restarting/rebuilding the live daemon (release is the operator's call, not this
  session's).

  Update `~/_GD/brain/projects/hive/known-issues.md` with a RESOLVED entry
  (match the file's existing entry style — see the `ea567cac`/`7fa45ca4`/
  `efc45b05` entries for the format) recording: the fix commit hash, that it
  generalizes past brain-chat to all managed-mirror skills, and the "not yet
  released" caveat so a future dispatch reporting the same brain-chat duplicate
  (or any of the other 44) short-circuits here instead of re-diagnosing.

  Do NOT push, build, or release — commit to `main` only, per this loop's
  established operator-releases boundary.
