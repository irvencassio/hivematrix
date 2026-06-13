import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Discovery + its cache live under $HOME; point HOME at a temp dir with one
// fake git repo so the scan is deterministic and isolated.
const TMP = mkdtempSync(join(tmpdir(), "hm-projdisc-test-"));
process.env.HOME = TMP;
mkdirSync(join(TMP, "myproj", ".git"), { recursive: true });
writeFileSync(join(TMP, "myproj", ".git", "HEAD"), "ref: refs/heads/main");
writeFileSync(join(TMP, "myproj", "package.json"), JSON.stringify({ name: "myproj" }));

const { discoverProjectsFresh, discoverProjects } = await import("./project-discovery");

test.after(() => { delete process.env.HOME; rmSync(TMP, { recursive: true, force: true }); });

test("fresh scan finds the git repo", () => {
  const p = discoverProjectsFresh();
  assert.ok(p.some((x) => x.name === "myproj"), "myproj discovered");
  assert.ok(p[0].lastModified instanceof Date);
});

test("cached read revives lastModified to a Date (regression: '0 projects')", () => {
  // discoverProjectsFresh above wrote the cache (Date serialized to a string).
  const cached = discoverProjects();
  assert.ok(cached.length >= 1);
  // The /projects handler does p.lastModified.toISOString(); this must not throw.
  assert.doesNotThrow(() => cached[0].lastModified.toISOString());
  assert.ok(cached[0].lastModified instanceof Date, "revived to Date, not left a string");
});
