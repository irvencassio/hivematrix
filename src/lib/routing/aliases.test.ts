import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// resolveProjectByName's discovery fallback reads $HOME (via
// project-discovery.ts) — point HOME at a temp dir with one fake git repo,
// same isolation pattern as project-discovery-cache.test.ts, so the scan is
// deterministic and doesn't depend on this machine's real repos.
// realpathSync: on macOS, os.tmpdir() returns a path under the /var/folders
// symlink, but project-discovery.ts's scanGitRepos() canonicalizes discovered
// paths via realpathSync (resolving to /private/var/folders/...) — canonicalize
// TMP once up front so the exact-path assertion below compares like with like.
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "hm-aliases-test-")));
process.env.HOME = TMP;
mkdirSync(join(TMP, "SomeRepo", ".git"), { recursive: true });
writeFileSync(join(TMP, "SomeRepo", ".git", "HEAD"), "ref: refs/heads/main");
writeFileSync(join(TMP, "SomeRepo", "package.json"), JSON.stringify({ name: "SomeRepo" }));

const { resolveProject, resolveProjectByName } = await import("./aliases");
const { discoverProjectsFresh } = await import("./project-discovery");
discoverProjectsFresh(); // populate the cache resolveProjectByName's fallback reads

test.after(() => { delete process.env.HOME; rmSync(TMP, { recursive: true, force: true }); });

test("resolveProject keeps legacy ops alias mapped to home", () => {
  assert.equal(resolveProject("ops"), homedir());
});

test("resolveProjectByName resolves a discovered git repo by case-insensitive name", () => {
  const resolved = resolveProjectByName("somerepo");
  assert.ok(resolved, "expected a match");
  assert.equal(resolved!.name, "SomeRepo");
  assert.equal(resolved!.path, join(TMP, "SomeRepo"));
});

test("resolveProjectByName returns null when nothing matches", () => {
  assert.equal(resolveProjectByName("no-such-project-anywhere"), null);
});

test("resolveProjectByName returns null for blank input", () => {
  assert.equal(resolveProjectByName("   "), null);
});
